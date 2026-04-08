mkdir -p filetree

for ext in py ipynb json html geojson csv txt js css png svg zip md; do
  find . -not -path './.git/*' -name "*.$ext" | sort > filetree/$ext.txt
  echo "Generated filetree/$ext.txt ($(wc -l < filetree/$ext.txt) files)"
done