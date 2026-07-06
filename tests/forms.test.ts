import { describe, expect, test } from "bun:test";
import { getFormSearchParams } from "../src/client/forms.ts";

describe("GET form serialization", () => {
  test("preserves every string value using URLSearchParams encoding", () => {
    const data = new FormData();
    data.append("tag", "one");
    data.append("tag", "two");
    data.append("empty", "");
    data.append("query", "a value & more");

    const query = getFormSearchParams(data);

    expect(query.getAll("tag")).toEqual(["one", "two"]);
    expect(query.get("empty")).toBe("");
    expect(query.toString()).toBe("tag=one&tag=two&empty=&query=a+value+%26+more");
  });

  test("uses FormData's standard string conversion for appended values", () => {
    const data = new FormData();
    data.append("count", 42 as unknown as string);
    data.append("enabled", false as unknown as string);

    expect(getFormSearchParams(data).toString()).toBe("count=42&enabled=false");
  });

  test("rejects file values instead of silently dropping them", () => {
    const data = new FormData();
    data.append("attachment", new File(["contents"], "notes.txt", { type: "text/plain" }));

    expect(() => getFormSearchParams(data)).toThrow(TypeError);
    expect(() => getFormSearchParams(data)).toThrow("cannot intercept a GET form containing files");
  });
});
