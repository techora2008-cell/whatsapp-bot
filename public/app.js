/**
 * Techora WhatsApp Broadcast Center
 * App Controller (Frontend Logic)
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const statusCard = document.getElementById('status-card');
    const statusDot = document.getElementById('status-dot');
    const statusLabel = document.getElementById('status-label');
    
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnRunBroadcast = document.getElementById('btn-run-broadcast');
    const btnStopBroadcast = document.getElementById('btn-stop-broadcast');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    const sentStats = document.getElementById('sent-stats');
    const btnResetBroadcast = document.getElementById('btn-reset-broadcast');
    const btnSaveConfig = document.getElementById('btn-save-config');
    const btnLogout = document.getElementById('btn-logout');
    const btnUploadImage = document.getElementById('btn-upload-image');
    
    const qrPlaceholder = document.getElementById('qr-placeholder');
    const qrPlaceholderText = document.getElementById('qr-placeholder-text');
    const qrCodeWrapper = document.getElementById('qr-code-wrapper');
    const qrCanvas = document.getElementById('qr-canvas');
    
    const progressText = document.getElementById('progress-text');
    
    const settingsForm = document.getElementById('settings-form');
    const imageFileInput = document.getElementById('image-file-input');
    const fileNameLabel = document.getElementById('file-name-label');
    const imgPreview = document.getElementById('img-preview');
    
    const targetRadios = document.getElementsByName('targetType');
    const singleTargetWrapper = document.getElementById('single-target-wrapper');
    const listTargetWrapper = document.getElementById('list-target-wrapper');
    
    const inputSingle = document.getElementById('input-single');
    const inputList = document.getElementById('input-list');
    const inputCaption = document.getElementById('input-caption');
    const inputMinSeconds = document.getElementById('input-min-seconds');
    const inputMaxSeconds = document.getElementById('input-max-seconds');
    
    const terminalWindow = document.getElementById('terminal-window');
    const toastContainer = document.getElementById('toast-container');

    // --- State Variables ---
    let currentClientStatus = 'stopped';
    let sseSource = null;

    // --- Toast Notification helper ---
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let iconClass = 'bx-info-circle';
        if (type === 'success') iconClass = 'bx-check-circle';
        if (type === 'warning') iconClass = 'bx-error-circle';
        if (type === 'error') iconClass = 'bx-x-circle';
        
        toast.innerHTML = `
            <i class="bx ${iconClass}"></i>
            <div class="toast-content">${message}</div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px) scale(0.9)';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 4000);
    }

    // --- Toggle Form Elements ---
    function handleTargetTypeChange(value) {
        if (value === 'single') {
            singleTargetWrapper.style.display = 'block';
            listTargetWrapper.style.display = 'none';
        } else {
            singleTargetWrapper.style.display = 'none';
            listTargetWrapper.style.display = 'block';
        }
    }

    // Bind event listeners to target selection radios
    targetRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            handleTargetTypeChange(e.target.value);
        });
    });

    // --- Load Configuration Settings ---
    async function loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Failed to load configuration');
            
            const config = await response.json();
            
            // Populate fields
            inputCaption.value = config.caption || '';
            inputList.value = config.listContent || '';
            inputSingle.value = config.single || '';
            inputMinSeconds.value = config.minSeconds || 60;
            inputMaxSeconds.value = config.maxSeconds || 120;
            
            // Image updates
            if (config.image) {
                imgPreview.src = `/${config.image}?t=${Date.now()}`;
                fileNameLabel.textContent = config.image.split('/').pop();
            } else {
                imgPreview.src = 'https://placehold.co/600x400/10171d/10b981?text=No+Image+Selected';
                fileNameLabel.textContent = 'No image selected';
            }
            
            // Radio buttons
            targetRadios.forEach(radio => {
                if (radio.value === config.type) {
                    radio.checked = true;
                    handleTargetTypeChange(radio.value);
                }
            });
            
            // Query current campaign history count
            try {
                const historyResponse = await fetch('/api/broadcast/history');
                if (historyResponse.ok) {
                    const historyResult = await historyResponse.json();
                    if (sentStats) {
                        sentStats.textContent = `Campaign Progress: ${historyResult.count} messages sent so far.`;
                    }
                }
            } catch (historyErr) {
                console.error('Error loading campaign history:', historyErr);
            }
            
            showToast('Configuration loaded successfully', 'info');
        } catch (err) {
            console.error('Error loading configuration:', err);
            showToast(`Error loading configuration: ${err.message}`, 'error');
        }
    }

    // --- Save Configuration ---
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const selectedRadio = Array.from(targetRadios).find(r => r.checked);
        const type = selectedRadio ? selectedRadio.value : 'both';
        
        const minSeconds = parseInt(inputMinSeconds.value) || 60;
        const maxSeconds = parseInt(inputMaxSeconds.value) || 120;
        
        if (minSeconds < 60) {
            showToast('Minimum delay cannot be less than 60 seconds (1 minute) for anti-ban safety.', 'warning');
            inputMinSeconds.value = 60;
            return;
        }
        
        const configData = {
            caption: inputCaption.value,
            type: type,
            listContent: inputList.value,
            single: inputSingle.value,
            minSeconds: minSeconds,
            maxSeconds: maxSeconds
        };
        
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configData)
            });
            
            const result = await response.json();
            if (result.success) {
                showToast('Configuration saved and applied!', 'success');
            } else {
                throw new Error(result.error || 'Server rejected changes');
            }
        } catch (err) {
            console.error('Error saving configuration:', err);
            showToast(`Failed to save configuration: ${err.message}`, 'error');
        }
    });

    // --- Handle Media Image Upload ---
    imageFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        fileNameLabel.textContent = file.name;
        
        // Instant preview
        const reader = new FileReader();
        reader.onload = (event) => {
            imgPreview.src = event.target.result;
        };
        reader.readAsDataURL(file);
        
        // Upload to server
        const formData = new FormData();
        formData.append('image', file);
        
        try {
            showToast('Uploading image...', 'info');
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            if (result.success) {
                showToast('Image uploaded and linked successfully!', 'success');
                // Ensure preview source is correct path from backend
                imgPreview.src = `/${result.imagePath}?t=${Date.now()}`;
                fileNameLabel.textContent = result.imagePath.split('/').pop();
            } else {
                throw new Error(result.error || 'Upload error');
            }
        } catch (err) {
            console.error('Error uploading image:', err);
            showToast(`Image upload failed: ${err.message}`, 'error');
            imgPreview.src = 'https://placehold.co/600x400/10171d/10b981?text=Upload+Failed';
        }
    });

    // --- Render QR Code ---
    function renderQr(qrText) {
        if (!qrText) return;
        
        qrPlaceholder.classList.remove('active');
        qrCodeWrapper.classList.add('active');
        
        QRCode.toCanvas(qrCanvas, qrText, {
            width: 180,
            margin: 1,
            color: {
                dark: '#030712',
                light: '#ffffff'
            }
        }, function(error) {
            if (error) {
                console.error('QR code generation error:', error);
                showToast('Failed to render QR Code', 'error');
            }
        });
    }

    // --- Update Client State and Button Interactivity ---
    function updateStateUI(status) {
        currentClientStatus = status;
        
        // Reset card statuses
        statusCard.className = 'status-indicator';
        statusDot.className = 'status-dot';
        
        switch (status) {
            case 'stopped':
                statusCard.classList.add('stopped');
                statusLabel.textContent = 'OFFLINE';
                statusDot.classList.remove('pulsing');
                
                // Buttons
                btnStart.classList.remove('btn-disabled');
                btnStart.removeAttribute('disabled');
                btnStop.classList.add('btn-disabled');
                btnStop.setAttribute('disabled', 'true');
                btnRunBroadcast.classList.add('btn-disabled');
                btnRunBroadcast.setAttribute('disabled', 'true');
                btnStopBroadcast.classList.add('btn-disabled');
                btnStopBroadcast.setAttribute('disabled', 'true');
                
                // Extra connection/session buttons
                btnLogout.classList.remove('btn-disabled');
                btnLogout.removeAttribute('disabled');
                
                // Broadcast Settings and campaign stats
                btnResetBroadcast.classList.remove('btn-disabled');
                btnResetBroadcast.removeAttribute('disabled');
                btnSaveConfig.classList.remove('btn-disabled');
                btnSaveConfig.removeAttribute('disabled');
                btnUploadImage.classList.remove('btn-disabled');
                
                // QR Elements
                qrPlaceholder.classList.add('active');
                qrPlaceholderText.textContent = 'Launch WhatsApp Client to view login QR code';
                qrPlaceholder.querySelector('i').className = 'bx bx-qr-scan';
                qrCodeWrapper.classList.remove('active');
                
                progressText.textContent = 'Client offline';
                break;
                
            case 'starting':
                statusCard.classList.add('starting');
                statusLabel.textContent = 'LAUNCHING...';
                statusDot.classList.add('pulsing');
                
                // Buttons
                btnStart.classList.add('btn-disabled');
                btnStart.setAttribute('disabled', 'true');
                btnStop.classList.remove('btn-disabled');
                btnStop.removeAttribute('disabled');
                btnRunBroadcast.classList.add('btn-disabled');
                btnRunBroadcast.setAttribute('disabled', 'true');
                btnStopBroadcast.classList.add('btn-disabled');
                btnStopBroadcast.setAttribute('disabled', 'true');
                
                // Extra connection/session buttons
                btnLogout.classList.add('btn-disabled');
                btnLogout.setAttribute('disabled', 'true');
                
                // Broadcast Settings and campaign stats
                btnResetBroadcast.classList.add('btn-disabled');
                btnResetBroadcast.setAttribute('disabled', 'true');
                btnSaveConfig.classList.add('btn-disabled');
                btnSaveConfig.setAttribute('disabled', 'true');
                btnUploadImage.classList.add('btn-disabled');
                
                // QR Elements
                qrPlaceholder.classList.add('active');
                qrPlaceholderText.textContent = 'Spawning browser environment. Please wait...';
                qrPlaceholder.querySelector('i').className = 'bx bx-loader-alt spinner';
                qrCodeWrapper.classList.remove('active');
                
                progressText.textContent = 'Starting chrome service...';
                break;
                
            case 'qr':
                statusCard.classList.add('qr');
                statusLabel.textContent = 'AWAITING LOGIN';
                statusDot.classList.add('pulsing');
                
                // Buttons
                btnStart.classList.add('btn-disabled');
                btnStart.setAttribute('disabled', 'true');
                btnStop.classList.remove('btn-disabled');
                btnStop.removeAttribute('disabled');
                btnRunBroadcast.classList.add('btn-disabled');
                btnRunBroadcast.setAttribute('disabled', 'true');
                btnStopBroadcast.classList.add('btn-disabled');
                btnStopBroadcast.setAttribute('disabled', 'true');
                
                // Extra connection/session buttons
                btnLogout.classList.remove('btn-disabled');
                btnLogout.removeAttribute('disabled');
                
                // Broadcast Settings and campaign stats
                btnResetBroadcast.classList.remove('btn-disabled');
                btnResetBroadcast.removeAttribute('disabled');
                btnSaveConfig.classList.remove('btn-disabled');
                btnSaveConfig.removeAttribute('disabled');
                btnUploadImage.classList.remove('btn-disabled');
                
                progressText.textContent = 'Awaiting QR Code Authentication';
                break;
                
            case 'ready':
                statusCard.classList.add('ready');
                statusLabel.textContent = 'READY';
                statusDot.classList.remove('pulsing');
                
                // Buttons
                btnStart.classList.add('btn-disabled');
                btnStart.setAttribute('disabled', 'true');
                btnStop.classList.remove('btn-disabled');
                btnStop.removeAttribute('disabled');
                btnRunBroadcast.classList.remove('btn-disabled');
                btnRunBroadcast.removeAttribute('disabled');
                btnStopBroadcast.classList.add('btn-disabled');
                btnStopBroadcast.setAttribute('disabled', 'true');
                
                // Extra connection/session buttons
                btnLogout.classList.remove('btn-disabled');
                btnLogout.removeAttribute('disabled');
                
                // Broadcast Settings and campaign stats
                btnResetBroadcast.classList.remove('btn-disabled');
                btnResetBroadcast.removeAttribute('disabled');
                btnSaveConfig.classList.remove('btn-disabled');
                btnSaveConfig.removeAttribute('disabled');
                btnUploadImage.classList.remove('btn-disabled');
                
                // QR Elements
                qrPlaceholder.classList.add('active');
                qrPlaceholderText.textContent = 'Successfully logged in to WhatsApp. Ready to broadcast.';
                qrPlaceholder.querySelector('i').className = 'bx bx-check-double';
                qrPlaceholder.querySelector('i').style.color = 'var(--primary)';
                qrCodeWrapper.classList.remove('active');
                
                progressText.textContent = 'Idle - Ready to broadcast messages';
                break;
                
            case 'broadcasting':
                statusCard.classList.add('broadcasting');
                statusLabel.textContent = 'BROADCASTING';
                statusDot.classList.add('pulsing');
                
                // Buttons
                btnStart.classList.add('btn-disabled');
                btnStart.setAttribute('disabled', 'true');
                btnStop.classList.add('btn-disabled');
                btnStop.setAttribute('disabled', 'true');
                btnRunBroadcast.classList.add('btn-disabled');
                btnRunBroadcast.setAttribute('disabled', 'true');
                btnStopBroadcast.classList.remove('btn-disabled');
                btnStopBroadcast.removeAttribute('disabled');
                
                // Extra connection/session buttons (disable all other actions)
                btnLogout.classList.add('btn-disabled');
                btnLogout.setAttribute('disabled', 'true');
                
                // Broadcast Settings and campaign stats (disable all editing/resets)
                btnResetBroadcast.classList.add('btn-disabled');
                btnResetBroadcast.setAttribute('disabled', 'true');
                btnSaveConfig.classList.add('btn-disabled');
                btnSaveConfig.setAttribute('disabled', 'true');
                btnUploadImage.classList.add('btn-disabled');
                
                // QR Elements
                qrPlaceholder.classList.add('active');
                qrPlaceholderText.textContent = 'Broadcast transmission in progress...';
                qrPlaceholder.querySelector('i').className = 'bx bx-send';
                qrPlaceholder.querySelector('i').style.color = '#8b5cf6';
                qrCodeWrapper.classList.remove('active');
                
                progressText.textContent = 'Sending messages in sequences...';
                break;
        }
    }

    // --- Stream Logs & States via SSE ---
    function initSSE() {
        if (sseSource) {
            sseSource.close();
        }
        
        sseSource = new EventSource('/api/logs/stream');
        
        sseSource.addEventListener('message', (e) => {
            const data = JSON.parse(e.data);
            
            if (data.type === 'status') {
                updateStateUI(data.status);
            } 
            else if (data.type === 'qr') {
                renderQr(data.qr);
            } 
            else if (data.type === 'log') {
                appendLogLine(data.message);
            }
            else if (data.type === 'history') {
                if (sentStats) {
                    sentStats.textContent = `Campaign Progress: ${data.count} messages sent so far.`;
                }
            }
        });
        
        sseSource.onerror = (err) => {
            console.error('SSE connection lost. Re-establishing connection...', err);
            // Auto connection status showing offline to prevent false expectation
            updateStateUI('stopped');
        };
    }

    // --- Append Logs to UI Monospace Terminal Window ---
    function appendLogLine(message) {
        const line = document.createElement('div');
        line.className = 'terminal-line';
        line.textContent = message;
        
        // Dynamic formatting based on log content
        if (message.includes('[SUCCESS]')) {
            line.classList.add('success-line');
        } else if (message.includes('[ERROR]')) {
            line.classList.add('error-line');
        } else if (message.includes('[WARNING]')) {
            line.classList.add('warning-line');
        } else if (message.includes('[STATUS]')) {
            line.classList.add('status-line');
        } else {
            line.classList.add('system-line');
        }
        
        terminalWindow.appendChild(line);
        
        // Auto scroll
        terminalWindow.scrollTop = terminalWindow.scrollHeight;
        
        // Update parsing text for status cards from standard logs if any progress metrics
        const progressMatch = message.match(/\[(\d+)\/(\d+)\] Sending to/);
        if (progressMatch) {
            progressText.textContent = `Transmission Progress: ${progressMatch[1]} of ${progressMatch[2]} chats`;
        } else if (message.includes('Broadcast completed successfully')) {
            progressText.textContent = 'Broadcast transmission completed successfully!';
        } else if (message.includes('Waiting for') && message.includes('seconds')) {
            const secondsMatch = message.match(/Waiting for (\d+) seconds/);
            if (secondsMatch) {
                progressText.textContent = `Delay wait: ${secondsMatch[1]} seconds remaining...`;
            }
        }
    }

    // --- Control Buttons Click Listeners ---
    btnStart.addEventListener('click', async () => {
        try {
            showToast('Starting Puppeteer environment...', 'info');
            const response = await fetch('/api/start', { method: 'POST' });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Server error');
        } catch (err) {
            showToast(`Could not start client: ${err.message}`, 'error');
        }
    });

    btnStop.addEventListener('click', async () => {
        try {
            showToast('Stopping client connection...', 'warning');
            const response = await fetch('/api/stop', { method: 'POST' });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Server error');
        } catch (err) {
            showToast(`Could not stop client: ${err.message}`, 'error');
        }
    });

    btnRunBroadcast.addEventListener('click', async () => {
        try {
            showToast('Launching broadcast sequence...', 'success');
            const response = await fetch('/api/broadcast/run', { method: 'POST' });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Server error');
        } catch (err) {
            showToast(`Could not launch broadcast: ${err.message}`, 'error');
        }
    });

    btnStopBroadcast.addEventListener('click', async () => {
        try {
            showToast('Halting broadcast sequence...', 'warning');
            const response = await fetch('/api/broadcast/stop', { method: 'POST' });
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Server error');
        } catch (err) {
            showToast(`Could not halt broadcast: ${err.message}`, 'error');
        }
    });

    btnClearLogs.addEventListener('click', () => {
        terminalWindow.innerHTML = '<div class="terminal-line system-line">[System] Console log display cleared. Running services unaffected.</div>';
        showToast('Console history view cleared', 'info');
    });

    if (btnResetBroadcast) {
        btnResetBroadcast.addEventListener('click', async () => {
            const confirmReset = confirm("Are you sure you want to reset the campaign history? This will clear the list of already messaged chats, and the next run will start fresh.");
            if (confirmReset) {
                try {
                    showToast('Resetting campaign history...', 'warning');
                    const response = await fetch('/api/broadcast/reset', { method: 'POST' });
                    const result = await response.json();
                    if (result.success) {
                        showToast('Campaign history has been reset. Fresh run ready.', 'success');
                        if (sentStats) {
                            sentStats.textContent = `Campaign Progress: 0 messages sent so far.`;
                        }
                    } else {
                        throw new Error(result.error || 'Server error');
                    }
                } catch (err) {
                    showToast(`Could not reset campaign history: ${err.message}`, 'error');
                }
            }
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            const confirmLogout = confirm("Are you sure you want to delete your WhatsApp session data? This will log you out and require a new QR scan next time.");
            if (confirmLogout) {
                try {
                    showToast('Deleting WhatsApp session data...', 'warning');
                    const response = await fetch('/api/logout', { method: 'POST' });
                    const result = await response.json();
                    if (result.success) {
                        showToast('WhatsApp session deleted. Ready for new connection.', 'success');
                    } else {
                        throw new Error(result.error || 'Server error');
                    }
                } catch (err) {
                    showToast(`Failed to delete session: ${err.message}`, 'error');
                }
            }
        });
    }

    // --- Init ---
    loadConfig();
    initSSE();
});
