export function page(items, number, size) {
  const start = (number - 1) * size;
  return items.slice(start, start + size - 1);
}
