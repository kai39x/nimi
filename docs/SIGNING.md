# Signing

Two different signatures:

- **Updater signature** (minisign, Tauri's updater): lets an installed NIMI accept an update from
  «حدّث الحين». The public key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); the
  private key is **only** on Kai's PC: `%USERPROFILE%\.tauri\nimi-updater.key` (no password). Keep a backup copy somewhere safe:
  without it, no future release can update installed copies. The release workflow signs the final
  installer with it when the repository secret `TAURI_SIGNING_PRIVATE_KEY` holds the key file's
  content, and publishes `latest.json`, which installed copies read from
  `releases/latest/download/latest.json`.
- **Code signing** (Authenticode, SignPath, below): removes the "Windows protected your PC" warning.

# Code signing (SignPath Foundation)

Unsigned exe files make Windows show "Windows protected your PC". SignPath Foundation signs open
source projects for free. The release workflow is ready for it; what is left is Kai's application
and four values in the repository settings.

## 1. Apply (Kai)

1. Turn on two-factor authentication on GitHub (SignPath requires MFA for everyone with access).
2. Apply at <https://signpath.org/apply>. Useful answers:
   - Repository: <https://github.com/kai39x/nimi>, MIT license, released (v1.0.0, v1.0.1).
   - Build: GitHub Actions, `.github/workflows/release.yml`, on `v*` tags, from this repository only.
   - Files to sign: `NIMI_<version>_x64-setup.exe` (NSIS installer) and
     `NIMI_<version>_portable.exe`.
   - Team: kai39x is author, reviewer and approver.
   - Privacy: nothing is sent by default. Two opt-in exceptions: the OpenPhish list (off by
     default) and the manual «Check for updates» button.
3. Wait for approval. SignPath then creates the organization and the project.

Their conditions (signpath.org/terms) that this repository already meets: OSI license (MIT), no
proprietary code, released, automated build from source, an uninstaller, a «Code signing policy»
section in the README, product name "NIMI" and the same version in every file of a build. They may
also ask for the privacy notes to be shown during installation; that is an NSIS page we can add.

## 2. Set up the project in SignPath (Kai, in their web app)

- Project slug: `nimi`.
- Trusted build system: GitHub.com, linked to this repository.
- Signing policy slug: `release-signing`, with manual approval by kai39x.
- Artifact configuration (default), for the two exe files the workflow uploads as one zip:

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file-set>
      <include path="*.exe" min-matches="2" max-matches="2" />
      <for-each>
        <authenticode-sign />
      </for-each>
    </pe-file-set>
  </zip-file>
</artifact-configuration>
```

- An API token for a user with "submitter" rights.

## 3. Connect the workflow (GitHub → Settings → Secrets and variables → Actions)

| Kind | Name | Value |
|---|---|---|
| Variable | `SIGNPATH_ORGANIZATION_ID` | the organization id from SignPath |
| Variable | `SIGNPATH_PROJECT_SLUG` | `nimi` |
| Variable | `SIGNPATH_POLICY_SLUG` | `release-signing` |
| Secret | `SIGNPATH_API_TOKEN` | the API token |

While `SIGNPATH_ORGANIZATION_ID` is empty the signing steps are skipped and releases stay unsigned,
as today.

## 4. Each release

Push the tag as usual. The workflow uploads the two exe files, SignPath asks Kai to approve the
request (email / web), the workflow waits up to an hour, checks that both files carry a valid
signature, and publishes them.

Note: the installer and the portable exe are signed. The `nimi.exe` inside the installer is not
(signing it would need Tauri's `signCommand` to call SignPath during the build); Windows checks the
downloaded installer, so the warning goes away either way.
