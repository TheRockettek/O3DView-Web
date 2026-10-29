import test from "node:test";
import assert from "node:assert/strict";
import { parseCTC, parseCTI } from "../src/repaints.js";

test("parses CTC texture slots without mistaking other config commands for slots", () => {
    const result = parseCTC([
        "[CTC]", "Colorscheme", "Texture\\Repaints", "0",
        "[CTCTexture]", "Body", "body.png",
        "[ctctexture]", "Glass", "glass.dds",
        "[CTCTexture]", "BODY", "duplicate.png",
        "[mesh]", "a.o3d", "[CTCTexture]", "orphan", "no.png",
    ]);
    assert.deepEqual(result.ctc, {
        variable: "Colorscheme", path: "Texture\\Repaints", unknown: "0",
        textures: [{ name: "Body", path: "body.png" }, { name: "Glass", path: "glass.dds" }],
    });
    assert.match(result.warnings.join("\n"), /duplicate \[CTCTexture\]/);
    assert.match(result.warnings.join("\n"), /has no active \[CTC\]/);
});

test("parses CTI schemes with multiple slots and item-scoped setvars", () => {
    const result = parseCTI([
        "[item]", "Blue", "Body", "blue.dds",
        "[setvar]", "window", "0.5",
        "[item]", "Blue", "Glass", "glass.dds",
        "-<DISABLED>-", "[setvar]", "disabled", "1", "-<ENABLED>-",
        "[item]", "Red", "Body", "red.dds",
    ]);
    assert.deepEqual(result.items.map(item => [item.name, item.slot, item.path, item.setvars]), [
        ["Blue", "Body", "blue.dds", [{ name: "window", value: 0.5 }]],
        ["Blue", "Glass", "glass.dds", []],
        ["Red", "Body", "red.dds", []],
    ]);
    assert.deepEqual(result.warnings, []);
});

test("malformed fields warn without swallowing following commands", () => {
    const result = parseCTI([
        "[setvar]", "orphan", "1", "[item]", "Broken", "[item]", "Good", "Body", "g.dds",
        "[setvar]", "bad", "1e100", "[setvar]", "valid", "-2", "[unknown]", "[setvar]", "orphan2", "0",
    ]);
    assert.deepEqual(result.items[0].setvars, [{ name: "valid", value: -2 }]);
    assert.equal(result.warnings.length, 4);
    assert.match(result.warnings.join("\n"), /requires 3 parameters/);
    assert.match(result.warnings.join("\n"), /finite 32-bit/);
    assert.equal(parseCTC("[CTC]\na\nb\n[CTCTexture]\nx\ny").warnings.length, 2);
    assert.throws(() => parseCTI(null), TypeError);
});
