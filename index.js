const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Helper to delay execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Help menu
function printHelp() {
    console.log(`
WhatsApp Image & Caption Broadcast Bot
======================================
Usage:
  node index.js --image <path_to_image> [options]

Required:
  --image <path>      Path to the image file to send (e.g., --image my-photo.jpg)

Options:
  --caption <text>    Caption to send along with the image (e.g., --caption "Check this out!")
  --caption-file <p>  Path to a text file containing the caption (useful for multiline/Unicode text)
  --type <type>       Target types to send to if no list/single target is specified. 
                      Values: 'contacts', 'groups', 'both' (default: 'both')
  --list <file_path>  Path to a text file containing target phone numbers or group IDs (one per line).
                      If specified, the bot will ONLY send to targets in this list.
  --single <target>   Send to a single contact/group. Can be a name, phone number, or JID.
                      (e.g., --single "My Group" or --single "919876543210" or --single "12345-6789@g.us")
  --help              Display this help menu
`);
}

// Parse command-line arguments
const args = process.argv.slice(2);
const options = {
    image: null,
    caption: '',
    captionFile: null,
    type: 'both',
    list: null,
    single: null,
    help: false
};

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
        options.help = true;
    } else if (args[i] === '--image' && i + 1 < args.length) {
        options.image = args[i + 1];
        i++;
    } else if (args[i] === '--caption' && i + 1 < args.length) {
        options.caption = args[i + 1];
        i++;
    } else if (args[i] === '--caption-file' && i + 1 < args.length) {
        options.captionFile = args[i + 1];
        i++;
    } else if (args[i] === '--type' && i + 1 < args.length) {
        options.type = args[i + 1].toLowerCase();
        i++;
    } else if (args[i] === '--list' && i + 1 < args.length) {
        options.list = args[i + 1];
        i++;
    } else if (args[i] === '--single' && i + 1 < args.length) {
        options.single = args[i + 1];
        i++;
    }
}

if (options.help) {
    printHelp();
    process.exit(0);
}

if (!options.image) {
    console.error('Error: Missing required argument --image <path>');
    printHelp();
    process.exit(1);
}

const absoluteImagePath = path.resolve(options.image);
if (!fs.existsSync(absoluteImagePath)) {
    console.error(`Error: Image file not found at: ${absoluteImagePath}`);
    process.exit(1);
}

// Load caption from file if specified
if (options.captionFile) {
    const absoluteCaptionPath = path.resolve(options.captionFile);
    if (!fs.existsSync(absoluteCaptionPath)) {
        console.error(`Error: Caption file not found at: ${absoluteCaptionPath}`);
        process.exit(1);
    }
    try {
        options.caption = fs.readFileSync(absoluteCaptionPath, 'utf-8');
        console.log(`Loaded caption from file: ${options.captionFile}`);
    } catch (err) {
        console.error(`Error reading caption file: ${err.message}`);
        process.exit(1);
    }
}

// Validate target type option
if (!['contacts', 'groups', 'both'].includes(options.type)) {
    console.error(`Error: Invalid type "${options.type}". Allowed: contacts, groups, both.`);
    process.exit(1);
}

// Parse custom list of targets if provided
let customTargets = null;
if (options.list) {
    const listPath = path.resolve(options.list);
    if (!fs.existsSync(listPath)) {
        console.error(`Error: Targets list file not found at: ${listPath}`);
        process.exit(1);
    }
    
    try {
        const fileContent = fs.readFileSync(listPath, 'utf-8');
        customTargets = fileContent
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#')); // ignore empty lines and comments
        
        console.log(`Loaded ${customTargets.length} targets from ${options.list}`);
    } catch (err) {
        console.error(`Error reading list file: ${err.message}`);
        process.exit(1);
    }
}

console.log('Starting WhatsApp client...');
console.log('Authentication session will be saved in .wwebjs_auth directory.');

// Initialize WhatsApp Web Client
const client = new Client({
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

// QR Code generation for authentication
client.on('qr', (qr) => {
    console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP TO LOG IN ---');
    qrcode.generate(qr, { small: true });
    console.log('--------------------------------------------------\n');
});

// Client is ready
client.on('ready', async () => {
    console.log('\nWhatsApp Client is ready!');
    console.log(`Logged in. Preparing to start broadcast...\n`);
    
    await runBroadcast();
});

// Authentication failure
client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

// Disconnection
client.on('disconnected', (reason) => {
    console.log('Client was logged out:', reason);
});

// Main broadcast function
async function runBroadcast() {
    try {
        console.log('Loading media...');
        const media = MessageMedia.fromFilePath(absoluteImagePath);
        console.log(`Media loaded successfully: ${path.basename(absoluteImagePath)}`);

        let targetJids = [];

        if (options.single) {
            console.log(`Resolving single target: "${options.single}"`);
            const targetVal = options.single.trim();
            
            if (targetVal.endsWith('@c.us') || targetVal.endsWith('@g.us')) {
                // Direct JID provided
                targetJids.push({ id: targetVal, name: targetVal });
            } else if (/^\+?\d+$/.test(targetVal.replace(/[\s-()]/g, ''))) {
                // Phone number provided (digits only, spaces, dashes, parens, optional plus)
                const cleanNum = targetVal.replace(/\D/g, '');
                targetJids.push({ id: `${cleanNum}@c.us`, name: targetVal });
            } else {
                // Name provided, search for matching chat
                console.log(`Searching for active chat with name matching "${targetVal}"...`);
                const chats = await client.getChats();
                const matchedChat = chats.find(c => c.name && c.name.toLowerCase() === targetVal.toLowerCase());
                
                if (matchedChat) {
                    targetJids.push({ id: matchedChat.id._serialized, name: matchedChat.name });
                    console.log(`Found matching chat: "${matchedChat.name}" (${matchedChat.id._serialized})`);
                } else {
                    console.error(`Error: Could not find any active chat named "${targetVal}".`);
                    console.log('\nAvailable chat names in your history:');
                    chats.forEach(c => {
                        if (c.name) console.log(` - ${c.name} (${c.isGroup ? 'Group' : 'Contact'})`);
                    });
                    process.exit(1);
                }
            }
        } else if (customTargets) {
            // Process custom target JIDs from file
            console.log('Formatting custom targets list...');
            for (let rawTarget of customTargets) {
                // If it's already a clean JID, use it
                if (rawTarget.endsWith('@c.us') || rawTarget.endsWith('@g.us')) {
                    targetJids.push({ id: rawTarget, name: rawTarget });
                } else {
                    // Check if it's a group-like string (contains hyphen)
                    if (rawTarget.includes('-')) {
                        targetJids.push({ id: `${rawTarget}@g.us`, name: rawTarget });
                    } else {
                        // Standard phone number: strip non-numeric characters
                        const cleanNum = rawTarget.replace(/\D/g, '');
                        if (cleanNum.length > 0) {
                            targetJids.push({ id: `${cleanNum}@c.us`, name: rawTarget });
                        }
                    }
                }
            }
        } else {
            // Retrieve targets from WhatsApp chat history
            console.log('Fetching chat list from WhatsApp (this may take a few seconds)...');
            const chats = await client.getChats();
            console.log(`Found ${chats.length} total active chats.`);

            const filteredChats = chats.filter(chat => {
                if (chat.isReadOnly) return false;
                
                const isGroup = chat.isGroup;
                if (options.type === 'groups') {
                    return isGroup;
                } else if (options.type === 'contacts') {
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

        // Sort targets: groups first (@g.us), then personal contacts (@c.us)
        if (targetJids.length > 1) {
            console.log('Sorting target list: sending to group chats first, then personal chats...');
            targetJids.sort((a, b) => {
                const aIsGroup = a.id.endsWith('@g.us');
                const bIsGroup = b.id.endsWith('@g.us');
                if (aIsGroup && !bIsGroup) return -1; // group comes first
                if (!aIsGroup && bIsGroup) return 1;  // contact comes after
                return 0; // maintain relative order
            });
        }

        console.log(`\nFinal target list contains ${targetJids.length} destinations.`);
        if (targetJids.length === 0) {
            console.log('No targets to send to. Exiting.');
            process.exit(0);
        }

        console.log('Broadcast starting in 5 seconds. Press Ctrl+C to abort.');
        await sleep(5000);

        for (let i = 0; i < targetJids.length; i++) {
            const target = targetJids[i];
            const targetType = target.id.endsWith('@g.us') ? 'Group' : 'Contact';
            
            console.log(`\n[${i + 1}/${targetJids.length}] Sending to ${targetType}: "${target.name}" (${target.id})...`);
            
            try {
                // Send the image with caption
                await client.sendMessage(target.id, media, { caption: options.caption });
                console.log(`[SUCCESS] Message sent to "${target.name}"`);
            } catch (err) {
                console.error(`[FAILURE] Failed to send to "${target.name}":`, err.message);
            }

            // Implement user-requested 1 to 2 minute delay between messages
            if (i < targetJids.length - 1) {
                const minSeconds = 60;  // 1 minute
                const maxSeconds = 120; // 2 minutes
                const delaySeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
                console.log(`Waiting ${delaySeconds} seconds (approx ${(delaySeconds / 60).toFixed(1)} mins) before the next send...`);
                
                // Print countdown logs periodically to keep user informed during the long wait
                for (let sec = delaySeconds; sec > 0; sec -= 30) {
                    if (sec > 30) {
                        await sleep(30000);
                        console.log(`  ... still waiting: ${sec - 30} seconds remaining`);
                    } else {
                        await sleep(sec * 1000);
                    }
                }
            }
        }

        console.log('\n======================================');
        console.log('Broadcast completed successfully!');
        console.log('======================================');
        process.exit(0);

    } catch (error) {
        console.error('Fatal broadcast error:', error);
        process.exit(1);
    }
}

// Start Client
client.initialize();
