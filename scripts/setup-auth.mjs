import { generateKeyPair, exportPKCS8, exportJWK } from "jose";
import { spawnSync } from "node:child_process";

const production = process.argv.includes("--prod");
function convex(args) {
  // Invoke the local CLI directly; keep secret values out of shell interpolation.
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/convex/bin/main.js",
      ...args,
      ...(production ? ["--prod"] : []),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      "Convex settings operation failed; private output withheld.",
    );
  return result.stdout;
}

const current = convex(["env", "list"]);
const hasPrivate = /^JWT_PRIVATE_KEY=/m.test(current);
const hasPublic = /^JWKS=/m.test(current);
if (hasPrivate !== hasPublic)
  throw new Error(
    "Only one sign-in key exists. Resolve settings before continuing.",
  );
if (!hasPrivate) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwt = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
  const jwk = await exportJWK(publicKey);
  convex(["env", "set", `JWT_PRIVATE_KEY=${jwt}`]);
  convex([
    "env",
    "set",
    `JWKS=${JSON.stringify({ keys: [{ use: "sig", ...jwk }] })}`,
  ]);
  console.log("Sign-in keys configured without writing them to a file.");
} else {
  console.log("Existing sign-in keys preserved.");
}
if (!/^SITE_URL=/m.test(current))
  convex(["env", "set", "SITE_URL=http://localhost:5173"]);
console.log("Local sign-in settings ready.");
