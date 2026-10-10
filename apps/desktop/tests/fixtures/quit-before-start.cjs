const { app } = require('electron');
// Keep startup pending so the production quit handler has no transcription session.
app.whenReady = () => new Promise(() => {});
require('../../dist/main.cjs');
app.quit();
setTimeout(() => { console.error('The early quit did not terminate the app.'); app.exit(1); }, 1500);
