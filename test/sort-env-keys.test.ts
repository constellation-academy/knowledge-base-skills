import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../plugins/knowledge-base/skills/setup-operator/scripts/sort-env-keys.py");
const hasPython = Bun.spawnSync(["python3", "--version"]).exitCode === 0;

const sort = (...keys: string[]) =>
  Object.fromEntries(
    Bun.spawnSync(["python3", "-I", SCRIPT, ...keys])
      .stdout.toString()
      .trim()
      .split("\n")
      .map((l) => l.split(" "))
      .map(([g, k]) => [k, g]),
  );

describe.if(hasPython)("sort-env-keys.py", () => {
  test("keys the new container sets itself", () => {
    expect(sort("NEO4J_PLUGINS", "NEO4J_apoc_import_file_enabled", "NEO4J_server_directories_import")).toEqual({
      NEO4J_PLUGINS: "own",
      NEO4J_apoc_import_file_enabled: "own",
      NEO4J_server_directories_import: "own",
    });
  });

  test("credential-like keys are never carried, in any case and spelling", () => {
    const keys = [
      "NEO4J_AUTH",
      "NEO4J_dbms_security_auth__enabled",
      "NEO4J_dbms_ssl_policy_bolt_private__key__password",
      "DB_PASSWD",
      "SSH_PASSPHRASE",
      "AWS_CREDS",
      "SERVICE_APIKEY",
      "service.apiKey",
      "APP_SECRETS",
      "GH_TOKENS",
      "MY_PWD",
      "NEO4J_apoc_jdbc_mydb_url",
      "BOLT_URI",
      "bolt.uri",
      "bolt-uri-main",
    ];
    for (const [k, g] of Object.entries(sort(...keys))) expect([k, g]).toEqual([k, "skip"]);
  });

  test("other keys are carried, security included", () => {
    expect(sort("NEO4J_dbms_security_procedures_unrestricted", "NEO4J_server_memory_heap_max__size", "TZ")).toEqual({
      NEO4J_dbms_security_procedures_unrestricted: "carry",
      NEO4J_server_memory_heap_max__size: "carry",
      TZ: "carry",
    });
  });
});
