// Creates an unpriced sample intake in an excluded disposable account only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const login=JSON.parse(fs.readFileSync(process.env.TRIPRELAY_TEST_LOGIN_FILE || 'tmp/quote-browser/login-private.json','utf8'));
 if(!login.email?.endsWith('@triprelay.invalid'))throw new Error('Use an excluded disposable test account for this browser check.');
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 try{
  await page.goto(process.env.TRIPRELAY_CHECK_URL || 'http://127.0.0.1:5173');
  await page.getByLabel('Email',{exact:true}).fill(login.email);await page.getByLabel('Password').fill(login.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Your enquiries'}).waitFor();
  await page.getByRole('button',{name:'Paste English enquiry'}).click();
  await page.getByLabel('Original forwarded English enquiry').fill('Vietnam for four adults, six nights, 9-12 November 2026. Compare 4-star or 5-star, private and shared transport, breakfast, lunch and dinner. Departure from Ahmedabad. Hanoi 2 nights, Ha Long 1 night, Da Nang 3 nights. Two rooms with two adults each.');
  await page.getByRole('button',{name:'Save original and check facts'}).click();
  await page.getByLabel('I checked the suggested facts and alternatives against the original. Unknown details remain blank.').check();
  await page.getByRole('button',{name:'Confirm checked facts'}).click();
  await page.getByRole('heading',{name:'Choices to price'}).waitFor();
  assert.equal(await page.locator('.comparison-options > li').count(),16);
  await page.getByText(/16 combinations from confirmed brief version/).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('heading',{name:'Choices to price'}).evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:'tmp/quote-browser/comparison-mobile.png'});
  await page.reload();await page.getByRole('button',{name:'Paste English enquiry'}).click();
  await page.getByRole('button',{name:/Brief confirmed/}).first().click();
  await page.getByRole('heading',{name:'Choices to price'}).waitFor();assert.equal(await page.locator('.comparison-options > li').count(),16);
  console.log('PASS: actual development intake confirmation, 16 combinations, 390px layout and reload; excluded disposable account; no prices or supplier/model calls.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
