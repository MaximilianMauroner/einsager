// Isolated blank editor for X11 keyboard/clipboard tests. No login or network access.
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 480, height: 240 });
  await window.loadURL('data:text/html,<textarea aria-label="Test editor" autofocus></textarea><script>window.enterKeys=0;document.addEventListener("keydown",e=>{if(e.key==="Enter")window.enterKeys++})</script>');
});
