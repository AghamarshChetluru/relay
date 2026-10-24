// Assembles a test page from the EXACT web assets that Gradle bundles into the APK (android/app/build/generated/relayAssets/web),
// adding only the fake bridge + real-engine fixtures. usage: node build_page.js
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..'), web = path.join(root, 'android/app/build/generated/relayAssets/web'), fx = path.join(root, 'android/app/build/fixtures/ui_fixtures.js');
if (!fs.existsSync(path.join(web, 'app.html'))) throw new Error('run ./gradlew :app:syncRelayAssets first');
if (!fs.existsSync(fx)) throw new Error('run ./gradlew :app:testDebugUnitTest first (writes fixtures)');
const out = path.join(root, 'android/app/build/native_ui_test'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(web)) fs.copyFileSync(path.join(web, f), path.join(out, f));
fs.copyFileSync(fx, path.join(out, 'ui_fixtures.js')); const ix = path.join(root, 'android/app/build/fixtures/inbox_fixtures.js'); if (fs.existsSync(ix)) fs.copyFileSync(ix, path.join(out, 'inbox_fixtures.js')); fs.copyFileSync(path.join(__dirname, 'fake_android.js'), path.join(out, 'fake_android.js'));
let html = fs.readFileSync(path.join(web, 'app.html'), 'utf8');
if (!html.includes('window.RELAY_NATIVE=true')) throw new Error('app.html is not the native variant');
html = html.replace('<script>window.RELAY_NATIVE=true;</script>', '<script src="ui_fixtures.js"></script>' + (fs.existsSync(path.join(out, 'inbox_fixtures.js')) ? '<script src="inbox_fixtures.js"></script>' : '') + '<script src="fake_android.js"></script><script>window.RELAY_NATIVE=true;</script>');
fs.writeFileSync(path.join(out, 'app_test.html'), html); console.log('built', out);
