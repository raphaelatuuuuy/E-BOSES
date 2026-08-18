import re
import os
from collections import defaultdict

BASE = r"C:\Users\TO GOD BE THE GLORY\Documents\S.Y. 2025-2026\CAPSTONE\Main"

results = []

def count_python_tests(filepath):
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
    
    classes = 0
    methods = 0
    standalone = 0
    fixtures = 0
    in_class = False
    class_indent = 0
    
    for line in lines:
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        
        if re.match(r'^class\s+\w*Test\w*\(', stripped):
            classes += 1
            in_class = True
            class_indent = indent
            continue
        
        if re.match(r'^def\s+test_', stripped) and indent == 0:
            standalone += 1
            continue
        
        if re.match(r'^def\s+test_', stripped) and indent > 0:
            methods += 1
            continue
        
        if re.match(r'^@pytest\.fixture', stripped):
            fixtures += 1
            continue
    
    return classes, methods, standalone, fixtures

def count_frontend_tests(filepath):
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    
    test_calls = len(re.findall(r'\btest\s*\(', content))
    it_calls = len(re.findall(r'\bit\s*\(', content))
    describe_blocks = len(re.findall(r'\bdescribe\s*\(', content))
    
    return test_calls, it_calls, describe_blocks

# Find all Python test files
py_test_files = []
for root, dirs, files in os.walk(BASE):
    for f in files:
        if f.startswith("test_") and f.endswith(".py"):
            py_test_files.append(os.path.join(root, f))
        elif f == "tests.py":
            py_test_files.append(os.path.join(root, f))

# Find all frontend test files
fe_test_files = []
for root, dirs, files in os.walk(BASE):
    for f in files:
        if re.search(r'\.(test|spec)\.(ts|tsx|js|jsx|mjs)$', f):
            fe_test_files.append(os.path.join(root, f))

all_files = sorted(py_test_files + fe_test_files)

for filepath in all_files:
    rel = os.path.relpath(filepath, BASE)
    if filepath.endswith(('.test.mjs', '.test.ts', '.test.tsx', '.test.js', '.test.jsx', '.spec.mjs', '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx')):
        test_calls, it_calls, describe = count_frontend_tests(filepath)
        total = test_calls + it_calls
        framework = "Jest/Vitest"
        results.append((rel, framework, test_calls, it_calls, describe, total, 0, 0, 0, 0))
    else:
        classes, methods, standalone, fixtures = count_python_tests(filepath)
        total = classes + methods + standalone
        results.append((rel, "pytest/Django", 0, 0, 0, total, classes, methods, standalone, fixtures))

# Print table
print(f"{'File':<90} {'Framework':<20} {'test()':<8} {'it()':<6} {'describe':<10} {'Total':<8} {'Classes':<10} {'Methods':<10} {'Standalone':<12} {'Fixtures':<10}")
print("-" * 185)

grand_test_calls = 0
grand_it_calls = 0
grand_describe = 0
grand_total = 0
grand_classes = 0
grand_methods = 0
grand_standalone = 0
grand_fixtures = 0

for row in results:
    print(f"{row[0]:<90} {row[1]:<20} {row[2]:<8} {row[3]:<6} {row[4]:<10} {row[5]:<8} {row[6]:<10} {row[7]:<10} {row[8]:<12} {row[9]:<10}")
    grand_test_calls += row[2]
    grand_it_calls += row[3]
    grand_describe += row[4]
    grand_total += row[5]
    grand_classes += row[6]
    grand_methods += row[7]
    grand_standalone += row[8]
    grand_fixtures += row[9]

print("-" * 185)
print(f"{'GRAND TOTAL':<90} {'':<20} {grand_test_calls:<8} {grand_it_calls:<6} {grand_describe:<10} {grand_total:<8} {grand_classes:<10} {grand_methods:<10} {grand_standalone:<12} {grand_fixtures:<10}")
print(f"\nPython test files: {len(py_test_files)}")
print(f"Frontend test files: {len(fe_test_files)}")
print(f"Total test files: {len(all_files)}")
