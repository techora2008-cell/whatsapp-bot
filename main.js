const { app, BrowserWindow } = require('electron');
const path = require('path');

// Set USER_DATA_DIR environment variable for server.js to use writable directory (before requiring server.js)
process.env.USER_DATA_DIR = app.getPath('userData');

// Start the Express server inside Electron's main process
require('./server.js');

let mainWindow;
let targetPort = null;
let isAppReady = false;

function launchAppWindow() {
    if (isAppReady && targetPort && !mainWindow) {
        createWindow(targetPort);
    }
}

function createWindow(port = 3000) {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        title: "Techora WhatsApp Broadcast Bot",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Remove the default browser menu bar for a clean desktop application look
    mainWindow.setMenuBarVisibility(false);

    // Load the web dashboard URL
    mainWindow.loadURL(`http://localhost:${port}`);

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// Create the window when the Express server reports it is listening
process.on('server-started', (port) => {
    targetPort = port;
    launchAppWindow();
});

app.on('ready', () => {
    isAppReady = true;
    if (targetPort) {
        launchAppWindow();
    } else {
        // Fallback timer: if after 3 seconds no server-started event fired, just load 3000
        setTimeout(() => {
            if (!mainWindow) {
                targetPort = global.expressServerPort || 3000;
                launchAppWindow();
            }
        }, 3000);
    }
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        const port = global.expressServerPort || 3000;
        createWindow(port);
    }
});
