/* Regression tests for the 2.13.9 security backports. Link the source static
 * archive so private buffer APIs exercise the exact patched implementation. */
#include "libxml.h"
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libxml/encoding.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/xinclude.h>
#include <libxml/xmlIO.h>
#include <libxml/xmlerror.h>
#include "private/buf.h"

static int failures;

static void check(int ok, const char *message) {
    if (!ok) {
        fprintf(stderr, "FAIL: %s\n", message);
        failures++;
    }
}

static int write_calls;
static int output(void *context, const char *data, int length) {
    (void) context;
    (void) data;
    write_calls++;
    return length;
}

static void output_boundary(int encoded, int operation, size_t length) {
    xmlCharEncodingHandlerPtr encoder = NULL;
    xmlOutputBufferPtr out;
    xmlBufPtr large;
    int result;
    char input[8193];

    memset(input, 'x', sizeof(input) - 1);
    input[sizeof(input) - 1] = 0;

    if (encoded) {
        encoder = xmlFindCharEncodingHandler("UTF-16LE");
        check(encoder != NULL, "UTF-16LE encoder exists");
        if (!encoder)
            return;
    }
    out = xmlOutputBufferCreateIO(output, NULL, NULL, encoder);
    check(out != NULL, "output buffer created");
    if (!out)
        return;

    /* malloc reserves virtual space; only the first and end pages are touched.
     * Never read the uninitialized bytes or send them to an I/O callback. */
    large = xmlBufCreateSize(length + 65536);
    check(large != NULL, "large virtual buffer reserved (no skipped boundary)");
    if (!large) {
        xmlOutputBufferClose(out);
        return;
    }
    check(xmlBufAddLen(large, length) == 0, "large buffer length initialized");
    if (encoded) {
        xmlBufFree(out->conv);
        out->conv = large;
    } else {
        xmlBufFree(out->buffer);
        out->buffer = large;
    }
    write_calls = 0;
    if (operation == 0)
        result = xmlOutputBufferFlush(out);
    else if (operation == 1)
        result = xmlOutputBufferWrite(out, sizeof(input) - 1, input);
    else
        result = xmlOutputBufferWriteEscape(out, BAD_CAST input, NULL);
    printf("XMLIO encoded=%d operation=%d length=%zu result=%d error=%d calls=%d\n",
           encoded, operation, length, result, out->error, write_calls);
    fflush(stdout);
    check(result == -1, "oversized output rejected");
    check(out->error == XML_ERR_INTERNAL_ERROR, "oversized output has safe error");
    check(write_calls == 0, "oversized length never reaches callback");
    xmlOutputBufferClose(out);
}

static void normal_output(void) {
    xmlOutputBufferPtr out = xmlOutputBufferCreateIO(output, NULL, NULL, NULL);
    check(out != NULL, "normal output buffer created");
    if (!out)
        return;
    write_calls = 0;
    check(xmlOutputBufferWrite(out, 5, "hello") >= 0, "normal output accepts data");
    check(xmlOutputBufferFlush(out) == 5, "normal output flushes exact length");
    check(write_calls == 1, "normal output callback is preserved");
    check(xmlOutputBufferClose(out) >= 0, "normal output closes");
}

static int include_requests;
static int include_nonet;
static xmlExternalEntityLoader previous_loader;

static xmlParserInputPtr include_loader(const char *url, const char *id,
                                        xmlParserCtxtPtr context) {
    if (url && strncmp(url, "http://security.invalid/", 24) == 0) {
        include_requests++;
        if (context && (context->options & XML_PARSE_NONET))
            include_nonet++;
        /* No network access occurs, including on the vulnerable baseline. */
        return NULL;
    }
    return previous_loader(url, id, context);
}

static void quiet_error(void *context, const char *message, ...) {
    (void) context;
    (void) message;
}

static void xinclude_flags(int operation) {
    static const char document[] =
        "<doc xmlns:xi='http://www.w3.org/2001/XInclude'>"
        "<xi:include href='http://security.invalid/text' parse='text'>"
        "<xi:fallback>TXTSAFE</xi:fallback></xi:include>"
        "<xi:include href='http://security.invalid/xml'>"
        "<xi:fallback><safe>XMLSAFE</safe></xi:fallback></xi:include></doc>";
    xmlDocPtr doc = xmlReadMemory(document, sizeof(document) - 1,
                                 "nonet-memory.xml", NULL, XML_PARSE_NONET);
    xmlChar *serialized = NULL;
    int size = 0, result;
    check(doc != NULL, "NONET input parsed");
    if (!doc)
        return;
    include_requests = include_nonet = 0;
    if (operation == 0)
        result = xmlXIncludeProcess(doc);
    else if (operation == 1)
        result = xmlXIncludeProcessTree(xmlDocGetRootElement(doc));
    else if (operation == 2)
        result = xmlXIncludeProcessFlags(doc, XML_PARSE_NONET);
    else
        result = xmlXIncludeProcessTreeFlags(xmlDocGetRootElement(doc), XML_PARSE_NONET);
    check(result == 2, "both XIncludes use fallback");
    check(include_requests == 2, "both text and XML loaders exercised");
    check(include_nonet == 2, "NONET inherited by every include context");
    xmlDocDumpMemory(doc, &serialized, &size);
    check(serialized && strstr((char *) serialized, "TXTSAFE") &&
          strstr((char *) serialized, "XMLSAFE"), "fallback content preserved");
    xmlFree(serialized);
    xmlFreeDoc(doc);
    printf("XINCLUDE operation=%d requests=%d nonet=%d: checked\n",
           operation, include_requests, include_nonet);
}

int main(void) {
    int encoded, operation;
    xmlInitParser();
    normal_output();
    for (encoded = 0; encoded < 2; encoded++) {
        for (operation = 0; operation < 3; operation++)
            output_boundary(encoded, operation, (size_t) INT_MAX);
        output_boundary(encoded, 0, (size_t) INT_MAX + 1);
    }
    previous_loader = xmlGetExternalEntityLoader();
    xmlSetExternalEntityLoader(include_loader);
    xmlSetGenericErrorFunc(NULL, quiet_error);
    for (operation = 0; operation < 4; operation++)
        xinclude_flags(operation);
    xmlSetExternalEntityLoader(previous_loader);
    xmlSetGenericErrorFunc(NULL, NULL);
    xmlCleanupParser();
    if (failures) {
        fprintf(stderr, "%d security boundary checks failed\n", failures);
        return 1;
    }
    puts("PASS: XMLIO callback lengths and XInclude NONET boundaries");
    return 0;
}
