#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "Usage: check-source.sh /path/to/built/libxml2-2.13.9" >&2
    exit 2
fi
source_dir=$(CDPATH= cd -- "$1" && pwd)
tests_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM

test -s "$source_dir/.libs/libxml2.a"
test -s "$source_dir/python/libxml2.py"
"${CC:-cc}" -std=c99 -Wall -Wextra \
    -I"$source_dir" -I"$source_dir/include" \
    "$tests_dir/security-boundaries.c" "$source_dir/.libs/libxml2.a" \
    -lz -llzma -lm -lpthread -o "$test_dir/security-boundaries"
"$test_dir/security-boundaries"

PYTHONPATH="$source_dir/python:$source_dir/python/.libs${PYTHONPATH:+:$PYTHONPATH}" \
LD_LIBRARY_PATH="$source_dir/.libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
PYTHONMALLOC=debug \
    "${PYTHON:-python3}" "$tests_dir/python-reference.py"
