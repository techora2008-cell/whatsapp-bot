const { app, BrowserWindow } = require('electron');
const path = require('path');

// Start the Express server inside Electron's main process
require('./server.js');

let mainWindow;

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
    if (!mainWindow) {
        createWindow(port);
    }
});

app.on('ready', () => {
    // If the event hasn't fired in 3 seconds, fall back and load the default port
    setTimeout(() => {
        if (!mainWindow) {
            const port = global.expressServerPort || 3000;
            createWindow(port);
        }
    }, 3000);
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
