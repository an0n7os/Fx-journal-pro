const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  
  // Ignore HTTP errors and navigate
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle2' }).catch(e => console.log('Goto error:', e.message));
  
  await page.setViewport({width: 1280, height: 800});
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({path: 'screenshot.png'});
  console.log("Screenshot saved to screenshot.png");

  const buttonHtml = await page.evaluate(() => {
    const btn = document.querySelector('button[title="Connect New Portfolio Account"]');
    if (btn) return btn.outerHTML;
    
    // Look for the dotted box
    const btns = Array.from(document.querySelectorAll('button'));
    const dottedBtn = btns.find(b => b.innerText.includes('Connect New Portfolio Account'));
    if (dottedBtn) return dottedBtn.outerHTML;
    
    return 'Button not found';
  });
  console.log("Button HTML:", buttonHtml);

  // Try to click the dotted button
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const dottedBtn = btns.find(b => b.innerText.includes('Connect New Portfolio Account'));
    if (dottedBtn) dottedBtn.click();
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  const modalHtml = await page.evaluate(() => {
    const modal = document.querySelector('.fixed.inset-0.z-50');
    return modal ? modal.outerHTML.substring(0, 500) : 'Modal not found';
  });
  console.log("Modal HTML:", modalHtml);

  await browser.close();
})();
