"""CVE-2026-74860: SAX attribute enumeration list retains its string items."""
import gc

import libxml2


class Handler:
    def __init__(self):
        self.declarations = []

    def attributeDecl(self, element, name, kind, default_kind, default, values):
        # Allocate strings before reading the list to expose freed item storage.
        noise = [f"allocation-{index:08d}-{'z' * 40}" for index in range(200)]
        assert len(noise) == 200
        expected = ["enumeration_alpha_value", "enumeration_beta_value"]
        assert values == expected, repr(values)
        self.declarations.append(values)


payload = (
    "<!DOCTYPE root [<!ELEMENT root EMPTY>"
    "<!ATTLIST root choice (enumeration_alpha_value|enumeration_beta_value) #IMPLIED>]>"
    "<root/>"
)
for iteration in range(100):
    handler = Handler()
    context = libxml2.createPushParser(handler, payload, len(payload), "reference.xml")
    assert context.parseChunk("", 0, 1) == 0
    del context  # parserCtxt.__del__ owns xmlFreeParserCtxt in the 2.13 binding.
    gc.collect()
    assert handler.declarations == [["enumeration_alpha_value", "enumeration_beta_value"]]
    del handler
print("PASS: CVE-2026-74860 Python enumeration item ownership (100 iterations)")
