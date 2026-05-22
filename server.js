const express = require('express');
const multer = require('multer');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static UI files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration for image upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `broadcast_image_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// Configuration path
const configPath = path.join(__dirname, 'config.json');
const sentHistoryPath = path.join(__dirname, 'sent_history.json');

// Memory state variables
let client = null;
let clientStatus = 'stopped'; // stopped, starting, qr, ready, broadcasting, done
let currentQr = null;
let logHistory = [];
let sseClients = [];
let activeBroadcastLoop = false;
let stopBroadcastRequest = false;

// Custom logging function
function logEvent(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const formattedLog = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    console.log(formattedLog);
    
    // Add to history (limit to 150 entries)
    logHistory.push(formattedLog);
    if (logHistory.length > 150) {
        logHistory.shift();
    }
    
    // Broadcast to SSE clients
    broadcastToClients({ type: 'log', message: formattedLog });
}

// Broadcast SSE updates to all open web dashboard screens
function broadcastToClients(data) {
    sseClients.forEach(clientRes => {
        clientRes.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

// Update client status and notify browser UI
function setClientStatus(status) {
    clientStatus = status;
    logEvent(`Status changed to: ${status.toUpperCase()}`, 'status');
    broadcastToClients({ type: 'status', status });
}

// Read config helper
function readConfig() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    } catch (err) {
        logEvent(`Error reading config: ${err.message}`, 'error');
    }
    return {
        image: '',
        caption: '',
        type: 'both',
        listContent: '',
        single: '',
        minSeconds: 60,
        maxSeconds: 120
    };
}

// Write config helper
function writeConfig(cfg) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
        return true;
    } catch (err) {
        logEvent(`Error saving config: ${err.message}`, 'error');
        return false;
    }
}

// Read sent history helper
function readSentHistory() {
    try {
        if (fs.existsSync(sentHistoryPath)) {
            return JSON.parse(fs.readFileSync(sentHistoryPath, 'utf-8'));
        }
    } catch (err) {
        logEvent(`Error reading sent history: ${err.message}`, 'error');
    }
    return [];
}

// Save sent history helper
function saveSentHistory(history) {
    try {
        fs.writeFileSync(sentHistoryPath, JSON.stringify(history, null, 2), 'utf-8');
        return true;
    } catch (err) {
        logEvent(`Error saving sent history: ${err.message}`, 'error');
        return false;
    }
}

// Reset sent history helper
function resetSentHistory() {
    try {
        if (fs.existsSync(sentHistoryPath)) {
            fs.unlinkSync(sentHistoryPath);
        }
        return true;
    } catch (err) {
        logEvent(`Error resetting sent history: ${err.message}`, 'error');
        return false;
    }
}

// --- REST API ENDPOINTS ---

// Get current configuration settings
app.get('/api/config', (req, res) => {
    res.json(readConfig());
});

// Update configuration settings
app.post('/api/config', (req, res) => {
    const config = readConfig();
    const newConfig = { ...config, ...req.body };
    
    // Safety check: force minSeconds to be at least 60
    if (newConfig.minSeconds !== undefined) {
        newConfig.minSeconds = Math.max(60, parseInt(newConfig.minSeconds) || 60);
    }
    
    if (writeConfig(newConfig)) {
        logEvent('Configuration updated successfully');
        res.json({ success: true, config: newConfig });
    } else {
        res.status(500).json({ error: 'Failed to write configuration' });
    }
});

// Handle image upload and update config
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const config = readConfig();
    const relativePath = `uploads/${req.file.filename}`;
    config.image = relativePath;
    
    if (writeConfig(config)) {
        logEvent(`New image uploaded: ${req.file.filename}`);
        res.json({ success: true, imagePath: relativePath });
    } else {
        res.status(500).json({ error: 'Failed to update configuration with image path' });
    }
});

// Server-Sent Events (SSE) endpoint for real-time logs/updates
app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send current state on connection
    res.write(`data: ${JSON.stringify({ type: 'status', status: clientStatus })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'history', count: readSentHistory().length })}\n\n`);
    if (currentQr) {
        res.write(`data: ${JSON.stringify({ type: 'qr', qr: currentQr })}\n\n`);
    }
    
    // Send existing logs history
    logHistory.forEach(log => {
        res.write(`data: ${JSON.stringify({ type: 'log', message: log })}\n\n`);
    });
    
    // Add client to active clients list
    sseClients.push(res);
    
    req.on('close', () => {
        sseClients = sseClients.filter(c => c !== res);
    });
});

// Start the WhatsApp Client and load Puppeteer
app.post('/api/start', (req, res) => {
    if (client) {
        return res.json({ success: true, message: 'Client already starting or running' });
    }
    
    logEvent('Initializing WhatsApp Client...');
    setClientStatus('starting');
    currentQr = null;
    stopBroadcastRequest = false;
    
    try {
        client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });
        
        client.on('qr', (qr) => {
            currentQr = qr;
            setClientStatus('qr');
            broadcastToClients({ type: 'qr', qr });
            logEvent('New QR Code generated, awaiting scan...');
        });
        
        client.on('ready', async () => {
            currentQr = null;
            setClientStatus('ready');
            logEvent('WhatsApp client logged in and ready!');
        });
        
        client.on('auth_failure', (msg) => {
            logEvent(`Authentication failure: ${msg}`, 'error');
            cleanupClient();
            deleteSessionDir();
        });
        
        client.on('disconnected', (reason) => {
            logEvent(`Client disconnected: ${reason}`, 'warning');
            cleanupClient();
            if (reason === 'LOGOUT') {
                deleteSessionDir();
            }
        });
        
        client.initialize();
        res.json({ success: true });
    } catch (err) {
        logEvent(`Failed to initialize client: ${err.message}`, 'error');
        cleanupClient();
        res.status(500).json({ error: err.message });
    }
});

// Stop the WhatsApp Client
app.post('/api/stop', async (req, res) => {
    logEvent('Stopping WhatsApp client and cleaning up session...');
    stopBroadcastRequest = true;
    await cleanupClient();
    res.json({ success: true });
});

// Trigger the Broadcast sending process
app.post('/api/broadcast/run', async (req, res) => {
    if (!client || clientStatus !== 'ready') {
        return res.status(400).json({ error: 'WhatsApp client is not logged in or ready.' });
    }
    if (activeBroadcastLoop) {
        return res.status(400).json({ error: 'Broadcast is already running.' });
    }
    
    runBroadcastLoop();
    res.json({ success: true });
});

// Stop or Pause the broadcast sending process
app.post('/api/broadcast/stop', (req, res) => {
    if (!activeBroadcastLoop) {
        return res.status(400).json({ error: 'Broadcast is not running.' });
    }
    stopBroadcastRequest = true;
    logEvent('Broadcast cancellation requested by user.', 'warning');
    res.json({ success: true });
});

// Get campaign sent history count
app.get('/api/broadcast/history', (req, res) => {
    res.json({ count: readSentHistory().length });
});

// Reset campaign sent history
app.post('/api/broadcast/reset', (req, res) => {
    resetSentHistory();
    logEvent('Campaign sent history reset by user. Starting fresh run.', 'warning');
    broadcastToClients({ type: 'history', count: 0 });
    res.json({ success: true, count: 0 });
});

// Logout and delete WhatsApp session data
app.post('/api/logout', async (req, res) => {
    logEvent('Logging out and deleting WhatsApp session...', 'warning');
    stopBroadcastRequest = true;
    
    if (client) {
        try {
            await client.logout();
        } catch (e) {
            console.error('Error logging out client:', e);
        }
        await cleanupClient();
    }
    
    deleteSessionDir();
    res.json({ success: true });
});

// Helper to delete session data
function deleteSessionDir() {
    const sessionPath = path.join(__dirname, '.wwebjs_auth');
    try {
        if (fs.existsSync(sessionPath)) {
            logEvent('Wiping saved session data directory to ensure a clean slate...', 'warning');
            fs.rmSync(sessionPath, { recursive: true, force: true });
            logEvent('Session data wiped successfully.', 'success');
        }
    } catch (err) {
        logEvent(`Failed to wipe session directory: ${err.message}`, 'error');
    }
}

// Helper to delay execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Cleanup client helper
async function cleanupClient() {
    setClientStatus('stopped');
    currentQr = null;
    activeBroadcastLoop = false;
    
    if (client) {
        try {
            await client.destroy();
        } catch (e) {
            console.error('Error destroying client:', e);
        }
        client = null;
    }
}

// The core broadcasting loop
async function runBroadcastLoop() {
    activeBroadcastLoop = true;
    setClientStatus('broadcasting');
    
    try {
        const config = readConfig();
        
        // 1. Resolve image path
        let imageAbsolutePath = '';
        if (config.image) {
            // Check if relative to public or root
            const publicPath = path.join(__dirname, 'public', config.image);
            const rootPath = path.join(__dirname, config.image);
            if (fs.existsSync(publicPath)) {
                imageAbsolutePath = publicPath;
            } else if (fs.existsSync(rootPath)) {
                imageAbsolutePath = rootPath;
            }
        }
        
        if (!imageAbsolutePath || !fs.existsSync(imageAbsolutePath)) {
            logEvent(`Image file not found: ${config.image || 'None'}`, 'error');
            setClientStatus('ready');
            activeBroadcastLoop = false;
            return;
        }
        
        logEvent(`Loading media from: ${imageAbsolutePath}`);
        const media = MessageMedia.fromFilePath(imageAbsolutePath);
        
        // 2. Load Targets
        let targetJids = [];
        
        if (config.single) {
            // Single target JID/Phone/Name
            const targetVal = config.single.trim();
            logEvent(`Resolving single target: "${targetVal}"`);
            
            if (targetVal.endsWith('@c.us') || targetVal.endsWith('@g.us')) {
                targetJids.push({ id: targetVal, name: targetVal });
            } else if (/^\+?\d+$/.test(targetVal.replace(/[\s-()]/g, ''))) {
                const cleanNum = targetVal.replace(/\D/g, '');
                targetJids.push({ id: `${cleanNum}@c.us`, name: targetVal });
            } else {
                logEvent(`Searching for active chat with name matching "${targetVal}"...`);
                const chats = await client.getChats();
                const matchedChat = chats.find(c => c.name && c.name.toLowerCase() === targetVal.toLowerCase());
                
                if (matchedChat) {
                    targetJids.push({ id: matchedChat.id._serialized, name: matchedChat.name });
                    logEvent(`Found matching chat: "${matchedChat.name}" (${matchedChat.id._serialized})`);
                } else {
                    logEvent(`Could not find chat named "${targetVal}". Listing chats in logs.`, 'error');
                    chats.forEach(c => {
                        if (c.name) logEvent(`  Available chat: "${c.name}" (${c.isGroup ? 'Group' : 'Contact'})`);
                    });
                    setClientStatus('ready');
                    activeBroadcastLoop = false;
                    return;
                }
            }
        } else if (config.listContent) {
            // Read lines from the custom targets field
            logEvent('Parsing targets from text input...');
            const lines = config.listContent
                .split(/\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
                
            for (let rawTarget of lines) {
                if (rawTarget.endsWith('@c.us') || rawTarget.endsWith('@g.us')) {
                    targetJids.push({ id: rawTarget, name: rawTarget });
                } else if (rawTarget.includes('-')) {
                    targetJids.push({ id: `${rawTarget}@g.us`, name: rawTarget });
                } else {
                    const cleanNum = rawTarget.replace(/\D/g, '');
                    if (cleanNum.length > 0) {
                        targetJids.push({ id: `${cleanNum}@c.us`, name: rawTarget });
                    }
                }
            }
        } else {
            // General Broadcast from Chat History
            logEvent('Fetching chat list from WhatsApp...');
            const chats = await client.getChats();
            logEvent(`Found ${chats.length} total active chats.`);
            
            const filteredChats = chats.filter(chat => {
                if (chat.isReadOnly) return false;
                
                const isGroup = chat.isGroup;
                if (config.type === 'groups') {
                    return isGroup;
                } else if (config.type === 'contacts') {
                    return !isGroup;
                } else {
                    return true;
                }
            });
            
            targetJids = filteredChats.map(chat => ({
                id: chat.id._serialized,
                name: chat.name || chat.id.user
            }));
        }
        
        // 3. Sort targets: Groups first, Contacts second
        if (targetJids.length > 1) {
            logEvent('Sorting target list: sending to group chats first, then personal chats...');
            targetJids.sort((a, b) => {
                const aIsGroup = a.id.endsWith('@g.us');
                const bIsGroup = b.id.endsWith('@g.us');
                if (aIsGroup && !bIsGroup) return -1;
                if (!aIsGroup && bIsGroup) return 1;
                return 0;
            });
        }
        
        // 4. Filter out targets already sent in this campaign
        const sentHistory = readSentHistory();
        const initialCount = targetJids.length;
        targetJids = targetJids.filter(target => !sentHistory.includes(target.id));
        const skippedCount = initialCount - targetJids.length;
        if (skippedCount > 0) {
            logEvent(`Campaign resume: Skipped ${skippedCount} chats that already received the message.`);
        }
        
        logEvent(`Final target list contains ${targetJids.length} destinations.`);
        if (targetJids.length === 0) {
            logEvent('No targets to send to. Aborting.');
            setClientStatus('ready');
            activeBroadcastLoop = false;
            return;
        }
        
        logEvent('Broadcast will start in 5 seconds...');
        await sleep(5000);
        
        for (let i = 0; i < targetJids.length; i++) {
            if (stopBroadcastRequest) {
                logEvent('Broadcast paused/stopped by user request.', 'warning');
                break;
            }
            
            const target = targetJids[i];
            const targetType = target.id.endsWith('@g.us') ? 'Group' : 'Contact';
            
            logEvent(`[${i + 1}/${targetJids.length}] Sending to ${targetType}: "${target.name}" (${target.id})...`);
            
            try {
                await client.sendMessage(target.id, media, { caption: config.caption });
                logEvent(`Message successfully sent to "${target.name}"`, 'success');
                const updatedHistory = readSentHistory();
                if (!updatedHistory.includes(target.id)) {
                    updatedHistory.push(target.id);
                    saveSentHistory(updatedHistory);
                    broadcastToClients({ type: 'history', count: updatedHistory.length });
                }
            } catch (err) {
                logEvent(`Failed to send to "${target.name}": ${err.message}`, 'error');
            }
            
            // Apply delay between sends (if not the last message)
            if (i < targetJids.length - 1 && !stopBroadcastRequest) {
                const min = parseInt(config.minSeconds) || 60;
                const max = parseInt(config.maxSeconds) || 120;
                const delay = Math.floor(Math.random() * (max - min + 1)) + min;
                
                logEvent(`Waiting for ${delay} seconds before next transmission to simulate human behavior...`);
                
                // Bounded loop for stop triggers during sleeping
                for (let sec = delay; sec > 0; sec -= 5) {
                    if (stopBroadcastRequest) break;
                    await sleep(sec > 5 ? 5000 : sec * 1000);
                }
            }
        }
        
        if (stopBroadcastRequest) {
            logEvent('Broadcast broadcast completed with interruptions.');
        } else {
            logEvent('Broadcast completed successfully to all targets!', 'success');
        }
        
        setClientStatus('ready');
    } catch (err) {
        logEvent(`Fatal error during broadcast: ${err.message}`, 'error');
        setClientStatus('ready');
    } finally {
        activeBroadcastLoop = false;
        stopBroadcastRequest = false;
    }
}
// Start backend server
let actualPort = PORT;
const server = app.listen(PORT);

server.on('listening', () => {
    logEvent(`=======================================================`);
    logEvent(`WhatsApp Broadcast Bot dashboard running at:`);
    logEvent(`http://localhost:${PORT}`);
    logEvent(`=======================================================`);
    
    // Auto open browser on successful startup
    try {
        const { exec } = require('child_process');
        exec(`start http://localhost:${PORT}`);
    } catch (e) {
        console.error('Failed to auto-open browser:', e);
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logEvent(`Port ${PORT} is already in use. Retrying on port 5000...`, 'warning');
        actualPort = 5000;
        const fallbackServer = app.listen(actualPort, () => {
            logEvent(`=======================================================`);
            logEvent(`WhatsApp Broadcast Bot dashboard running at:`);
            logEvent(`http://localhost:${actualPort}`);
            logEvent(`=======================================================`);
            
            // Auto open browser on fallback port
            try {
                const { exec } = require('child_process');
                exec(`start http://localhost:${actualPort}`);
            } catch (e) {
                console.error('Failed to auto-open browser:', e);
            }
        });
        
        fallbackServer.on('error', (fallbackErr) => {
            logEvent(`Failed to bind to fallback port ${actualPort}: ${fallbackErr.message}`, 'error');
            process.exit(1);
        });
    } else {
        logEvent(`Server startup error: ${err.message}`, 'error');
        process.exit(1);
    }
});

// Process-level crash prevention for Puppeteer/WWebJS asynchronous errors
process.on('unhandledRejection', (reason, promise) => {
    logEvent(`Asynchronous Unhandled Rejection: ${reason}`, 'error');
    if (reason && reason.message && reason.message.includes('detached Frame')) {
        // Safe state reset if client frame crashes
        cleanupClient();
    }
});

process.on('uncaughtException', (err) => {
    logEvent(`Uncaught Exception: ${err.message}`, 'error');
    if (err.message && err.message.includes('detached Frame')) {
        // Safe state reset if client frame crashes
        cleanupClient();
    }
});
