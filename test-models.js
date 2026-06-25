const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

app.whenReady().then(() => {
  try {
    const keyPath = 'C:\\Users\\iamka\\AppData\\Roaming\\compile-editor\\.compile-api-keys';
    const keyMap = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    const enc = Buffer.from(keyMap.google, 'base64');
    const apiKey = safeStorage.decryptString(enc);
    
    https.get('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.models) {
          console.log('Available models containing "pro":');
          console.log(json.models.map(m => m.name).filter(n => n.includes('pro')));
          console.log('Available models containing "flash":');
          console.log(json.models.map(m => m.name).filter(n => n.includes('flash')));
        } else {
          console.log('Error fetching models:', json);
        }
        app.quit();
      });
    });
  } catch (e) {
    console.error(e);
    app.quit();
  }
});
