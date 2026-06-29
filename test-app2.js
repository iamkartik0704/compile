const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

  console.log('Navigating to http://127.0.0.1:5174 ...');
  await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle2' });

  // Wait for sidebar files to appear
  console.log('Waiting for sidebar files...');
  try {
    await page.waitForSelector('.file-node', { timeout: 15000 });
    console.log('Found files. Clicking first file...');
    
    // Evaluate and click the first file that is not a directory
    await page.evaluate(() => {
      const files = Array.from(document.querySelectorAll('.file-node'));
      for (const f of files) {
        if (!f.querySelector('.lucide-folder')) {
          f.click();
          break;
        }
      }
    });

    console.log('Clicked file. Waiting 3 seconds for errors...');
    await new Promise(r => setTimeout(r, 3000));
  } catch (err) {
    console.log('Error during interaction:', err.message);
  }

  await browser.close();
})();
