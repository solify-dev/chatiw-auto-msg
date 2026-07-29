const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9333',
    defaultViewport: null,
  });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('chatiw')) || pages[0];
  const info = await page.evaluate(() => {
    const countries = document.querySelector('select[name="country"]');
    const age = document.querySelector('select[name="age"]');
    const zone = document.querySelector('select[name="zone"]');
    return {
      title: document.title,
      url: location.href,
      hasNick: !!document.querySelector('input[name="nickname"]'),
      countryDisabled: countries?.disabled,
      countrySelected: countries?.selectedOptions?.[0]
        ? { value: countries.selectedOptions[0].value, text: countries.selectedOptions[0].text }
        : null,
      japan: countries
        ? [...countries.options]
            .filter((o) => /japan/i.test(o.text))
            .map((o) => ({ value: o.value, text: o.text }))
        : [],
      countrySample: countries
        ? [...countries.options].slice(0, 15).map((o) => ({ value: o.value, text: o.text }))
        : [],
      countryCount: countries?.options?.length,
      ageCount: age?.options?.length,
      zoneHTML: zone?.innerHTML?.slice(0, 500),
      zoneDisplay: document.querySelector('#zone')?.style?.display,
      sex: [...document.querySelectorAll('input[name="sex"]')].map((i) => ({
        value: i.value,
        checked: i.checked,
      })),
      bodySnippet: document.body?.innerText?.slice(0, 400),
    };
  });
  fs.writeFileSync('form-debug.json', JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'form-debug.png', fullPage: true });
  await browser.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
