const AVATAR_COLORS = ["#E8D5B7","#D5E8D4","#B7D5E8","#E8B7D5","#D5D5B7","#E8D5D5","#B7E8D5","#D5B7E8"];

export function getProductAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function getProductInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
