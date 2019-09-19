# frag 📡

Asynchronously read fragments (select byte ranges) from a remote or local resource both in node.js and the browser, while automatically caching and stitching together the fragments in memory.

Includes buffering, asynchronous decode-as-you-read methods for the following proprietary datatypes (encoded using [bkit](https://github.com/blake-regalia/bkit.js)):
 - variable-width unsigned ints (vuint)
 - null-terminated UTF8-encoded strings (ntu8String)
 - length-prefixed UTF8-encoded strings (lpu8String)
 - class&length-prefixed TypedArrays:
   - Int8Array
   - Uint8Array
   - Uint8ClampedArray
   - Int16Array
   - Uint16Array
   - Int32Array
   - Uint32Array
   - Float32Array
   - Float64Array
   - BigInt64Array
   - BigUint64Array

## Reference
Working on generating API reference. See source code for documentation of methods in meantime.