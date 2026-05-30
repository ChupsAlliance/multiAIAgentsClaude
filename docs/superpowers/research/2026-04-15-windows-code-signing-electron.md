# Windows Code Signing for Electron Apps: Research Report

**Date**: 2026-04-15  
**Scope**: Code signing options to eliminate SmartScreen/antivirus warnings for electron-builder Windows distributions

---

## Executive Summary

**Critical Finding (March 2024)**: Microsoft changed SmartScreen behavior. EV certificates no longer provide instant reputation clearing. Both EV and OV certs now require reputation building.

**Best Path Forward**: Start with budget-friendly OV cert (~$65-211/yr) + reputation building (2-8 weeks, 15k downloads). If timeline critical, use Azure Trusted Signing ($9.99-99.99/month, non-EV). For open-source, use SignPath.io (free).

**SmartScreen Reality**: No legitimate way to bypass—only to build trust. Unsigned apps get blocked; signing accelerates reputation but doesn't instantly clear warnings (post-March 2024).

---

## 1. Windows Code Signing Certificates: EV vs OV

### Current State (2025)

| Factor | EV | OV |
|--------|----|----|
| **Validation** | Strict: ID, business registration, physical address required | Basic: Business registration + existence check |
| **SmartScreen** | No instant bypass (changed March 2024) | No instant bypass (changed March 2024) |
| **Price/year** | $400-900 | $65-300 |
| **Best for** | High-risk/high-visibility software | Startups, indie devs, cost-conscious |

### Key Insight

**As of March 2024, both EV and OV behave identically regarding SmartScreen**. EV no longer provides immediate trust. Both now rely on reputation building through download volume and clean behavior. The practical difference is validation rigor and price.

### Certificate Authority Pricing (2025)

| Provider | EV Price | OV Price | Notes |
|----------|----------|----------|-------|
| **Sectigo** | $249-300/yr | $65-211/yr | Lowest OV option; preferred by indie devs |
| **DigiCert** | $400-576/yr | $200-400/yr | Enterprise-grade; highest trust reputation |
| **SSL.com** | Flexible pricing | Flexible pricing | Cloud-based signing; modern workflows |
| **Certum** | Variable | Free (open-source) | EU provider; free OSS program |

**Recommendation**: Sectigo OV ($211/yr) for budget startups; DigiCert EV ($500+/yr) only if you need maximum validation rigor or are a large vendor.

---

## 2. EV Certificate Requirements & SmartScreen Reality

### Does EV Provide Instant Trust?

**No (as of March 2024).**

- Before: EV certs cleared SmartScreen immediately
- Now: EV certs still need reputation building just like OV
- Timeline: 2-8 weeks to clear organically (unofficial reports)

### Factors Affecting Reputation Building

| Factor | Impact |
|--------|--------|
| **Download volume** | 15,000+ safe downloads = recognized; 3-7 days with 10k+ downloads |
| **Geographic spread** | Global downloads = faster reputation |
| **User reports** | Malware/crash reports delay/block trust indefinitely |
| **Update frequency** | Unsigned daily builds = new "programs" each time (reputation resets) |

### SmartScreen Behavior Post-Signature

1. First download: Shows warning "Unknown publisher"
2. After signing: Still shows warning but with certificate chain (incremental trust)
3. After ~2-8 weeks + reputation: Warning disappears (depends on volume)

**Verdict**: Signing certificates reduce friction (shows cert details) but don't eliminate SmartScreen immediately. Reputation building is mandatory.

---

## 3. Microsoft Trusted Root Program & Microsoft Store

### Microsoft Store Distribution

**Status**: Not a direct SmartScreen bypass, but highly effective.

**Benefits**:
- App vetted by Microsoft; elevated trust
- No user warnings on install (Microsoft handles security)
- Broader audience; in-app store integration
- Auto-update mechanism

**Drawbacks**:
- 24-48 hour review cycle (some rejections)
- App must follow store submission guidelines
- Hosting costs (~$20-100/year for indie)
- More friction than direct download

**Recommendation**: Use Microsoft Store as distribution channel *alongside* signing (not replacement). Serves users who prefer store security; direct download with signed cert for others.

### Microsoft Trusted Root Program

**EV Certs Only**: Requires enrollment in Trusted Root Program (for kernel drivers, highly vetted). Not applicable to typical desktop apps.

---

## 4. electron-builder Windows Signing Configuration

### Basic Setup (OV Certificate)

**environment variables** (GitHub Actions or CI/CD):
```bash
export WIN_CSC_LINK="/path/to/certificate.pfx"  # Base64 encoded for CI
export WIN_CSC_KEY_PASSWORD="certificate_password"
```

**electron-builder.yml** or **package.json**:
```yaml
build:
  win:
    certificateFile: "path/to/certificate.pfx"
    certificatePassword: "${WIN_CSC_KEY_PASSWORD}"
    signingHashAlgorithms: ["sha256"]
    verifyUpdateCodeSignature: true
```

### EV Certificate (requires subject name)

```yaml
build:
  win:
    certificateFile: "path/to/ev-certificate.pfx"
    certificatePassword: "${WIN_CSC_KEY_PASSWORD}"
    certificateSubjectName: "Your Organization Name"  # Exact name from cert
    signingHashAlgorithms: ["sha256"]
```

### Azure Trusted Signing (Modern, Non-EV)

```yaml
build:
  win:
    azureSignOptions:
      endpoint: "https://[region].codesigning.azure.net/"
      accountName: "your-account"
      certificateProfileName: "your-profile"
      tenantId: "${AZURE_TENANT_ID}"
```

**Key Points**:
- Timestamp signing is automatic (electron-builder handles it)
- Use SHA256 hashing (SHA1 deprecated)
- Store certificate as base64 in GitHub Secrets if using CI/CD
- Password should NOT be in source control

---

## 5. CI/CD Signing (GitHub Actions)

### Option A: GitHub Secrets (Simplest)

**Setup**:
1. Encode certificate: `base64 -i cert.pfx -o cert.b64`
2. Add to GitHub Secrets: `WINDOWS_CERT` = certificate.b64 content
3. Add password secret: `WINDOWS_CERT_PASSWORD`

**Workflow**:
```yaml
- name: Decode certificate
  run: |
    echo "${{ secrets.WINDOWS_CERT }}" | base64 -d > cert.pfx
    
- name: Build & Sign
  env:
    WIN_CSC_LINK: "${{ github.workspace }}/cert.pfx"
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
  run: npm run build:win
  
- name: Cleanup
  run: rm cert.pfx
```

**Pros**: Simple, no external dependencies  
**Cons**: Secrets exposed in logs if leaked; manual cert rotation

### Option B: Azure Key Vault + OIDC (Enterprise-Grade)

**Setup**:
1. Store certificate in Azure Key Vault (Premium tier for HSM)
2. Create User-Assigned Managed Identity with OIDC federation
3. Authenticate GitHub Actions without long-lived secrets

**Workflow**:
```yaml
- name: Authenticate to Azure
  uses: azure/login@v1
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Fetch certificate from Key Vault
  run: |
    az keyvault secret show \
      --vault-name my-vault \
      --name cert-pfx \
      --query value -o tsv | base64 -d > cert.pfx

- name: Build & Sign
  env:
    WIN_CSC_LINK: "${{ github.workspace }}/cert.pfx"
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
  run: npm run build:win
```

**Pros**: No long-lived secrets; auto-rotating credentials; audit trails  
**Cons**: More setup; requires Azure subscription

### Option C: Azure Trusted Signing (Recommended Modern Path)

```yaml
- name: Authenticate to Azure
  uses: azure/login@v1
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Build & Sign with Azure Trusted Signing
  env:
    AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
  run: npm run build:win
```

**Pros**: Certificate stored in Azure (no local file); auto-managed lifecycle; cheapest at scale  
**Cons**: Requires Azure account; only available US/Canada

---

## 6. Free/Cheap Alternatives

### Option A: SignPath.io (Free for Open-Source)

**Eligibility**:
- OSI-approved open-source license (no proprietary components)
- Actively maintained
- Already released publicly

**Features**:
- Free EXE/MSI signing for OSS
- Hardware security module (HSM) storage
- Manual approval per release (not automated)
- Full audit trails

**Process**: Apply at [SignPath.org](https://signpath.org/), get approved, submit builds for manual signing.

**Timeline**: 1-2 weeks approval → 1-2 days per build signing

**Cost**: $0 (free)

### Option B: Certum Free OSS Certificate

**Eligibility**: Free Windows Authenticode cert for open-source developers

**Cost**: $0

**Drawback**: Limited support; EU-based CA

### Option C: Organic Reputation Building (No Certificate)

**Process**:
1. Distribute unsigned app to beta users
2. Collect 15,000+ safe downloads across geographic regions
3. Zero malware/crash reports
4. Wait 2-8 weeks

**Cost**: $0  
**Reality**: Impractical for paid apps; works for:
- Open-source with active user base
- Free utilities with viral adoption
- Internal tools with controlled rollout

**Timeline**: 3-8 weeks minimum; 6+ weeks typical

### Option D: Azure Trusted Signing (Cheapest Commercial)

**Cost**: $9.99/month (5,000 signatures) or $99.99/month (100,000)

**Best for**: Small teams, quick scaling

**Timeline**: Setup 1-2 hours; immediate signing after approval

---

## 7. SmartScreen Reputation Building Timeline

### Organic Building (Signed Cert, No EV)

| Download Volume | Timeline |
|-----------------|----------|
| 10,000+ | 3-7 days |
| 5,000-10,000 | 1-2 weeks |
| 1,000-5,000 | 2-4 weeks |
| <1,000 | 4-8 weeks+ or indefinite |

**Factors**:
- **Geographic diversity**: Worldwide users = faster (US-only = slower)
- **Update frequency**: New hash = new "app" = reputation resets
- **Negative signals**: Crashes or malware reports = indefinite delay

### Accelerating Reputation

1. **Request Microsoft review**: Submit to Microsoft SmartScreen for analysis (unblocks reputation)
2. **Wide initial distribution**: Beta release to tech bloggers, forums, subreddits
3. **GitHub Releases**: Published on GitHub increases download credibility
4. **Checksums/PGP signatures**: Publish SHA256 hashes for verification (reduces risk perception)

### No Way to Bypass

SmartScreen warnings cannot be bypassed legitimately. Only mitigations:
- Code signing (reduces warning visibility)
- Reputation building (eliminates warning)
- Microsoft Store (shifts trust to Microsoft)
- User education (unblock in SmartScreen UI: "Run anyway")

---

## 8. Practical Timelines & Costs

### Path 1: Budget Indie Dev (Recommended for <$500/yr)

| Step | Cost | Timeline |
|------|------|----------|
| 1. Buy Sectigo OV cert | $211/yr | 1-2 days |
| 2. Configure electron-builder | $0 | 1-2 hours |
| 3. Initial release (signed) | $0 | Immediate |
| 4. Build reputation | $0 | 4-8 weeks |
| **Total** | **$211/yr** | **4-8 weeks** |

**Outcome**: Users see "Unknown Publisher" (cert present) → after 4-8 weeks → no warning

### Path 2: Open-Source (Recommended for OSS)

| Step | Cost | Timeline |
|------|------|----------|
| 1. Apply to SignPath.io | $0 | 1-2 weeks approval |
| 2. Configure electron-builder | $0 | 1-2 hours |
| 3. Release 1.0 | $0 | 1-2 days (manual signing) |
| 4. Build reputation | $0 | 4-8 weeks |
| **Total** | **$0** | **5-10 weeks** |

**Outcome**: Free signing + organic reputation building

### Path 3: Fast Track (Urgent Timeline <2 weeks)

| Step | Cost | Timeline |
|------|------|----------|
| 1. Setup Azure Trusted Signing account | $10 | <1 hour |
| 2. Configure electron-builder | $0 | 1-2 hours |
| 3. First release (signed) | $0.005-10 | Immediate |
| 4. Optional: Submit to Microsoft for reputation | $0 | 1-2 days |
| **Total** | **$10-20/month** | **<1 day** |

**Outcome**: Signed app immediately; reduced (but not eliminated) SmartScreen warning; reputation building still takes 4-8 weeks

### Path 4: Enterprise Grade (Compliance-Heavy)

| Step | Cost | Timeline |
|------|------|----------|
| 1. Buy DigiCert EV cert | $500-900/yr | 2-5 days |
| 2. Azure Key Vault (Premium) | $600/yr | <1 day |
| 3. OIDC + Key Vault integration | $0 | 2-4 hours |
| 4. CI/CD pipeline setup | $0 | 4-8 hours |
| 5. Release | $0 | Immediate |
| **Total** | **$1,100-1,500/yr** | **<1 day** |

**Outcome**: Maximum validation rigor; auditable signing; regulated compliance

---

## 9. Recommendations by Scenario

### Indie Dev / Small Startup
- **Action**: Buy Sectigo OV cert ($211/yr), sign builds
- **Expect**: SmartScreen warning for 4-8 weeks, then clears
- **Cost**: $211/yr
- **Effort**: 2 hours setup, then automatic

### Open-Source Project
- **Action**: Apply to SignPath.io (free), release signed builds
- **Expect**: Manual approval per release (1-2 days), free signing forever
- **Cost**: $0
- **Effort**: 5 hours approval + 1-2 hours per release

### Bootstrapped Startup (Urgent)
- **Action**: Azure Trusted Signing ($10/month), build reputation simultaneously
- **Expect**: Signed immediately; SmartScreen still shows 4-8 weeks, but cert visible
- **Cost**: $10-20/month
- **Effort**: 3 hours setup, then automatic

### Enterprise / Regulated Industry
- **Action**: DigiCert EV + Azure Key Vault + OIDC pipeline
- **Expect**: Maximum security, auditability, compliance
- **Cost**: $1,100-1,500/yr
- **Effort**: 12-16 hours setup, then automatic + auditable

### Cannot Afford Cert Now (Patience > Money)
- **Action**: Distribute to closed beta (100-500 trusted users), build reputation organically
- **Expect**: 6-12 weeks to eliminate SmartScreen warning, zero cost
- **Cost**: $0
- **Effort**: Marketing + distribution effort only
- **Caveat**: Only viable if have time; public release will be blocked for weeks

---

## 10. Technical Debt & Gotchas

### Hardware Security Module (HSM) Requirement
**Since June 1, 2023**: All code signing certificate private keys must be stored on FIPS 140-2 Level 2 HSM or hardware token. Software-based OV certificates no longer sold.

**Impact**: No usable workarounds. Must use:
- Hardware tokens (physical USB device)
- Azure Key Vault (Premium) or Azure Trusted Signing
- SignPath (HSM managed for you)

### Timestamp Signing
**Critical**: Always enable timestamp signing (`signingHashAlgorithms: ["sha256"]`).

Without it: Certificate expires → signed app stops working (users can't run it).

With it: Signed app works forever (only cert chain verified, not expiry).

### Update Breaks Reputation
If distributing updates:
- Use auto-updater (electron-updater): Hash changes, but SmartScreen recognizes same app
- If users re-download installer: New hash = new "app" = reputation resets

**Best practice**: Sign updates transparently; avoid re-distribution if possible.

### Antivirus Warnings (Different from SmartScreen)

SmartScreen (Windows OS filter):
- Affects .exe downloads
- Eliminated by code signing + reputation

Antivirus/Firewall (third-party security):
- Separate from code signing
- Eliminated by:
  - Submitting hash to VirusTotal (free)
  - Whitelisting in antivirus (user-level)
  - Never happens with code signing alone

---

## 11. Unresolved Questions

1. **Does Azure Trusted Signing (non-EV) build reputation as fast as OV certs?** No direct comparison found; likely identical since both are non-EV post-March 2024.

2. **Can you use certificate pinning or manual overrides in electron-builder?** Not documented; likely not supported (Windows OS-level check).

3. **Does distributing via GitHub Releases build reputation faster?** No data found; likely marginal advantage (GitHub adds credibility, but download volume is primary factor).

4. **Exact cutoff for "15,000 downloads" for reputation?** Unofficial number; Microsoft doesn't publish exact thresholds.

5. **Does Sectigo OV have same reputation weight as DigiCert OV?** Both non-EV; likely identical post-March 2024, but DigiCert's trust chain may accelerate slightly (unconfirmed).

---

## Sources

- [SSL.com: EV vs OV Code Signing](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)
- [Microsoft Q&A: EV Certificates & SmartScreen](https://learn.microsoft.com/en-us/answers/questions/417016/reputation-with-ov-certificates-and-are-ev-certifi/)
- [DigiCert Code Signing Certificates](https://www.digicert.com/signing/code-signing-certificates)
- [Sectigo Code Signing Certificates](https://www.sectigo.com/ssl-certificates-tls/code-signing)
- [electron-builder Windows Code Signing](https://www.electron.build/code-signing-win.html)
- [Electron Code Signing Docs](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Microsoft: SmartScreen Reputation Building](https://learn.microsoft.com/en-us/archive/blogs/ie/smartscreen-application-reputation-building-reputation)
- [Azure Artifact Signing Pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [SignPath.io Open Source Code Signing](https://signpath.io/solutions/open-source-community)
- [GitHub Actions: Azure Key Vault Secrets](https://learn.microsoft.com/en-us/azure/developer/github/github-actions-key-vault)
- [Code Signing on Windows with Azure Trusted Signing](https://melatonin.dev/blog/code-signing-on-windows-with-azure-trusted-signing/)
- [Best SmartScreen AppRep Practices](https://textslashplain.com/2024/11/15/best-practices-for-smartscreen-apprep/)
- [Signing Electron Apps with GitHub Actions](https://dev.to/rwwagner90/signing-electron-apps-with-github-actions-4cof)
- [SignPath Foundation](https://signpath.org/)
- [Certum Open Source Code Signing](https://certum.store/open-source-code-signing-code.html)
