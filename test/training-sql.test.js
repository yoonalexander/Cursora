import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("hosted SQL persists idempotent submissions, enforces private access and limits bursts", async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    const sql = await readFile(new URL("../database/training.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await db.exec(sql); // Setup can be rerun without deleting the dataset.
    const example = { id: randomUUID(), label: "house", strokes: [] };
    await db.exec("set role service_role;");
    const collect = collector => db.query("select public.cursora_collect_example($1::jsonb, $2::text) as result", [JSON.stringify(example), collector]);
    assert.equal((await collect("hashed-collector")).rows[0].result, "saved");
    await db.query("update public.cursora_training_examples set review_status='approved', label='tree' where id=$1", [example.id]);
    await collect("hashed-collector");
    const stored = (await db.query("select label, review_status from public.cursora_training_examples")).rows;
    assert.deepEqual(stored, [{ label: "tree", review_status: "approved" }]);
    await db.exec("begin;");
    for (let i = 0; i < 30; i++) assert.equal((await collect("burst-collector")).rows[0].result, "saved");
    assert.equal((await collect("burst-collector")).rows[0].result, "rate_limited");
    await db.exec("commit;");
    for (const role of ["anon", "authenticated"]) {
        await db.exec(`reset role; set role ${role};`);
        await assert.rejects(() => db.query("select * from public.cursora_training_examples"), /permission denied/);
        await assert.rejects(() => collect("public-collector"), /permission denied/);
    }
});
