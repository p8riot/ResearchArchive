# The Research Archive | GitHub Pages package

**Application version:** 0.19.13  
**Status:** Feature-complete development build for owner testing. **Not yet certified as stable 1.0.0.**

This is the ready-to-upload **static website/PWA package**. It does **not** need Python, Node.js, GitHub Actions, a build process, or the Windows launcher. The ZIP contains everything necessary to serve the core local-first app through GitHub Pages.

## Publish on GitHub Pages

1. Sign in to GitHub and create or open a repository. Example repository name: `Research-Archive`.
2. **Extract this ZIP on your computer first.** In the repository, select **Add file → Upload files**, then upload **the files and folders inside the extracted ZIP** to the top level (root) of the repository; do **not** upload only the ZIP or a wrapper folder. Required root items include `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, plus `js/` and `icons/`. If GitHub's upload UI doesn't include the hidden `.nojekyll` file, you may create an empty root file named `.nojekyll` using **Add file → Create new file**, or use Git to upload it.
3. Commit the files to your default branch, usually `main`.
4. Go to **Settings → Pages → Build and deployment**. Select **Deploy from a branch**, select `main`, select `/(root)`, and save.
5. Once Pages publishes successfully, visit `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`. Example: `https://p8riot.github.io/Research-Archive/`. Use the **exact repository capitalization** and keep the **trailing slash**.
6. Test loading the Research Desk, saving a **disposable** case, reloading, and opening it again. Chrome or Edge can offer **Install app**; on iPhone/iPad use Safari's **Add to Home Screen**. Installation varies by browser/platform.

The application uses **relative asset, service-worker, manifest start and scope paths**. This means it works from a repository subfolder without manually changing URLs, provided the website is published at its project root.

## Data and privacy: read before using

- **GitHub hosts the application code, not users' saved local research.** New research is normally stored in each visitor's browser's local IndexedDB under that website origin; the repository must never include exports, backups, source documents or personal records.
- **A browser origin is a separate storage space.** Your existing Windows `http://localhost:8000` research will NOT automatically appear at `https://p8riot.github.io/...`. Keep using the Windows version until you've made and *verified* a backup; then use the app's restore procedure on the Pages site. Backups containing source file handles may require reselecting or restoring the original source files; verify attachments individually. **Do not clear browser/site data** as part of the move.
- Deleting browser data, changing hostnames, changing repository names or using a different browser/device can make earlier locally saved data unavailable. Keep independent backups.
- Cloud synchronization is optional, requires your own Supabase setup, and has **not** passed live two-account isolation testing. Do not enable it for other users before testing its security and access controls. No Supabase service-role secret should ever be committed into this repository.
- **All files you publish on GitHub Pages are public to visitors**, even when hosted from an eligible private repository. This cannot hide the client-side JavaScript from visitors. Review legal/rights and release readiness before distributing broadly.
- This application has **not** completed real installed-PWA offline/upgrade testing, true Windows secondary-drive restore, or screen-reader acceptance testing. Treat this as a deployable **test build**, not an approved production release.

## What to include

| Path | Purpose |
| --- | --- |
| `index.html` | Entry page and startup diagnostics |
| `styles.css` | Visual styling |
| `js/` | Main app and helper modules |
| `icons/` | Site and install icons |
| `manifest.webmanifest` | PWA name, start URL, scope, icons |
| `sw.js` | Offline app shell/service worker |
| `.nojekyll` | Disables Jekyll processing on GitHub Pages |
| `PACKAGE-CHECKSUMS.json` | Hashes of included deploy files (excluding itself) |
| `README.md` | This deployment guide |

**Not included:** `LAUNCH_WINDOWS.cmd`, `tools/serve_local.py`, Windows-specific instructions, development test harnesses, and personal research records.

## Updating

To deploy a future build, back up your research first, replace the web app files **without changing the repository or project URL**, and commit. The app uses a network-first online asset strategy with offline cache fallback. Close existing tabs/installed windows and reopen after deployment so the new worker can activate. Do not clear stored website data. Users may need to reconnect or reload to receive updated files.

## Troubleshooting

- **404 / white screen:** Verify `index.html` is at repository root and Pages has deployed successfully. Check the exact repository name and URL.
- **Buttons do not work:** Confirm the JS modules were uploaded under `js/` and the browser shows the correct `index.html` and JS paths. Look for the startup banner and the browser console's first error.
- **Not installable:** Use the HTTPS Pages URL, check `manifest.webmanifest` and `sw.js` can be fetched, and note some browsers do not present a separate install button.
- **Existing research appears missing:** You may be on a different browser origin. Return to `http://localhost:8000` in the same browser profile to locate the local copy; restore from verified backup when ready.

This package is not a standalone EXE or an automatically submitted app-store application.
