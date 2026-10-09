export function price(total, discount) {
  return total * (1 - (discount || 0.1));
}
