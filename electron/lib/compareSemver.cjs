'use strict';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function compareSemver(a, b) {
  const ma = SEMVER_RE.exec(a);
  const mb = SEMVER_RE.exec(b);
  if (!ma || !mb) return 0;

  for (let i = 1; i <= 3; i++) {
    const na = parseInt(ma[i], 10);
    const nb = parseInt(mb[i], 10);
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

module.exports = { compareSemver };
