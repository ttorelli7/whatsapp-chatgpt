const puppeteer = require('puppeteer');

export default async function browserScreenshot(url, path) {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ fullPage: true, path });
    await browser.close();
    return path;
}