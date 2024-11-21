import { PersistentShell } from "./shell.ts";

const shell = new PersistentShell()

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  console.log("Add 2 + 3 =");
}
