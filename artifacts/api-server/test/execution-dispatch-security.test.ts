import assert from "node:assert/strict";
import test from "node:test";
import { isNonGlobalRuntimeAddress } from "../src/middlewares/runtimeNetwork.ts";

test("runtime dispatch rejects private, loopback, link-local, reserved, and multicast addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.10.0.5",
    "172.16.1.2",
    "192.168.1.2",
    "169.254.10.2",
    "100.64.0.1",
    "192.0.2.10",
    "198.51.100.10",
    "203.0.113.10",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ]) {
    assert.equal(isNonGlobalRuntimeAddress(address), true, address);
  }
  assert.equal(isNonGlobalRuntimeAddress("8.8.8.8"), false);
  assert.equal(isNonGlobalRuntimeAddress("2001:4860:4860::8888"), false);
});