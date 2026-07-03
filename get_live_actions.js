const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Capture console messages
  page.on('console', msg => {
    if (msg.text().includes('MONACO_ACTIONS_DUMP')) {
      require('fs').writeFileSync('live_actions.txt', msg.text());
    }
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
