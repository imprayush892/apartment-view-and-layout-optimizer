"""Build the deployable site: investor landing page (deploy/index.html, edited by hand) + the app under deploy/app/.
   python3 tools/build_site.py   -> deploy/app/ refreshed from web/ (adds the document skeleton the artifact host would add)."""
import pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB, OUT = ROOT / "web", ROOT / "deploy" / "app"
if OUT.exists(): shutil.rmtree(OUT)
(OUT / "js").mkdir(parents=True); (OUT / "data").mkdir()
for f in (WEB / "js").glob("*.js"): shutil.copy2(f, OUT / "js" / f.name)
for f in (WEB / "data").glob("*.json"): shutil.copy2(f, OUT / "data" / f.name)
body = (WEB / "index.html").read_text()
(OUT / "index.html").write_text('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n' + body + '\n</body></html>\n')
print("deploy/app:", sum(1 for _ in OUT.rglob("*") if _.is_file()), "files")
