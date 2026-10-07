export function ownsBot(user, bot) {
  if (!user || !bot) return false;
  if (bot.ownerUserId && String(bot.ownerUserId) === String(user.id)) return true;
  if (!bot.ownerUserId && [user.username, user.email].filter(Boolean).includes(bot.username)) return true;
  return (user.botUsernames || []).includes(bot.username);
}

export function canEditResource(user, permission, bot) {
  if (!user || !(user.permissions || []).includes(permission)) return false;
  if (user.role === "admin") return true;
  const scope = user.scopes?.[permission];
  if (scope === "all") return true;
  const isOwn = !!bot && ((bot.ownerUserId && String(bot.ownerUserId) === String(user.id)) || (!bot.ownerUserId && [user.username, user.email].filter(Boolean).includes(bot.username)));
  const assigned = !!bot && (user.botUsernames || []).includes(bot.username);
  if (scope === "own") return isOwn;
  if (scope === "assigned") return assigned;
  if (scope === "own_assigned") return isOwn || assigned;
  return false;
}
