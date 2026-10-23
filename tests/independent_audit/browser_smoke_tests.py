from playwright.sync_api import sync_playwright
from pathlib import Path
import os, shutil, sys

ROOT=Path(__file__).parent
def inline(name):
  html=(ROOT/name).read_text()
  css='style.css' if name=='index.html' else 'sim.css'
  js='app.js' if name=='index.html' else 'sim.js'
  html=html.replace(f'<link rel="stylesheet" href="{css}">','<style>'+ (ROOT/css).read_text()+'</style>')
  html=html.replace('<script src="mesh.js"></script>','<script>'+ (ROOT/'mesh.js').read_text()+'</script>')
  html=html.replace(f'<script src="{js}"></script>','<script>'+ (ROOT/js).read_text()+'</script>')
  return html

counts={'pass':0,'fail':0};fails=[]
def test(desc, action):
    try: action(); counts['pass']+=1;print('PASS',desc)
    except Exception as e: counts['fail']+=1;fails.append((desc,str(e)));print('FAIL',desc,str(e)[:240])

def real_request(url):return url.startswith(('http://','https://'))
def assert_true(x,msg=None):
    if not x:raise AssertionError(msg or 'assertion failed')

with sync_playwright() as p:
  candidates=[os.environ.get('RELAY_CHROMIUM_PATH'),shutil.which('chromium'),shutil.which('google-chrome'),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  executable=next((x for x in candidates if x and Path(x).exists()),None)
  browser=p.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox'] if sys.platform.startswith('linux') else [])
  for w in [375,390,430]:
    ctx=browser.new_context(viewport={'width':w,'height':844},device_scale_factor=1)
    page=ctx.new_page();errors=[];network=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('request',lambda req: network.append(req.url) if real_request(req.url) else None)
    page.set_content(inline('index.html'),wait_until='load')
    test(f'{w}px first run prompts for neighbourhood',lambda: assert_true(page.locator('#onboarding').is_visible()))
    page.locator('[data-hood="HK"]').click();page.locator('#ob-continue').click()
    test(f'{w}px onboarding completes',lambda: assert_true(page.locator('#onboarding').count()==0))
    test(f'{w}px no horizontal overflow on home',lambda: assert_true(page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')))
    page.locator('[data-nav="request"]').click()
    test(f'{w}px request form visible',lambda: assert_true(page.locator('#req-submit').is_visible()))
    page.locator('#btn-example').click();page.locator('#req-submit').click()
    test(f'{w}px emergency form submits to own activity',lambda: assert_true(page.get_by_text('Your request is saved').count()>0 or page.locator('#screen').inner_text().lower().count('saved')>0))
    page.locator('[data-nav="feed"]').click()
    test(f'{w}px feed loads',lambda: assert_true('Help requests' in page.locator('#screen').inner_text()))
    page.locator('[data-nav="activity"]').click()
    test(f'{w}px activity loads',lambda: assert_true('My activity' in page.locator('#screen').inner_text() or 'My requests' in page.locator('#screen').inner_text()))
    test(f'{w}px no JavaScript errors',lambda: assert_true(not errors,errors))
    test(f'{w}px no external requests',lambda: assert_true(not network,network))
    ctx.close()
  for w in [1280,1440]:
    ctx=browser.new_context(viewport={'width':w,'height':850})
    page=ctx.new_page();errors=[];network=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('request',lambda req: network.append(req.url) if real_request(req.url) else None)
    page.set_content(inline('simulator.html'),wait_until='load')
    test(f'{w}px simulator boots with 80 real model nodes',lambda: assert_true(page.evaluate('Mesh.state().order.length')==80))
    test(f'{w}px simulator UI distinct from app',lambda: assert_true(page.locator('#screen').count()==0))
    test(f'{w}px simulator renders canvas/node map',lambda: assert_true(page.locator('svg').count()>0 or page.locator('canvas').count()>0))
    test(f'{w}px no simulator JavaScript errors',lambda: assert_true(not errors,errors))
    test(f'{w}px no external network requests',lambda: assert_true(not network,network))
    ctx.close()
  browser.close()
print(f'RESULT {counts["pass"]}/{counts["pass"]+counts["fail"]} pass')
if fails:
  for desc,e in fails:print('FAILED',desc,e)
  raise SystemExit(1)
