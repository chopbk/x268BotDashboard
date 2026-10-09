-- Shared wb:ex protocol. Full REST writes require the version read BEFORE fetching.
-- ARGV: mode, bodyJson, expectedVersion|eventTime, atIso, account, reconcileMs(optional)
local raw = redis.call('GET', KEYS[1])
local old = raw and cjson.decode(raw) or {}
local revision = tonumber(redis.call('GET', KEYS[2]) or '0')
local input = cjson.decode(ARGV[2])
local mode = ARGV[1]
if mode == 'full' and revision ~= tonumber(ARGV[3]) then return raw or '' end
local next = old
if mode == 'full' then
  local oldClocks = old.eventTimes or {}
  local clocks = {}
  local seen = {}
  local fence = tonumber(ARGV[6] or '0')
  for k,v in pairs(input) do
    if k ~= 'eventTimes' then next[k] = v end
  end
  for _,p in ipairs(input.positions or {}) do
    local key = p.symbol .. '|' .. (p.positionSide or 'BOTH')
    seen[key] = true
    -- Keep live clocks; do not raise them to reconcile time or late ACCOUNT_UPDATE cannot apply.
    clocks[key] = math.max(tonumber(oldClocks[key] or '0'), tonumber(p.updateTime or '0'))
  end
  -- Tombstone only symbols absent from the REST book so late deltas cannot revive them.
  for key, stamp in pairs(oldClocks) do
    if not seen[key] then
      clocks[key] = math.max(tonumber(stamp or '0'), fence)
    end
  end
  for _,p in ipairs(old.positions or {}) do
    local key = p.symbol .. '|' .. (p.positionSide or 'BOTH')
    if not seen[key] then
      clocks[key] = math.max(tonumber(clocks[key] or oldClocks[key] or '0'), fence)
    end
  end
  next.eventTimes = clocks
  next.complete = true
  next.reconciledAt = ARGV[4]
else
  local positions = old.positions or {}
  local clocks = old.eventTimes or {}
  local changed = false
  for _,p in ipairs(input.positions) do
    local key = p.symbol .. '|' .. p.positionSide
    local stamp = tonumber(ARGV[3])
    if stamp > tonumber(clocks[key] or '0') then
      local found = nil
      for i,row in ipairs(positions) do
        if row.symbol == p.symbol and row.positionSide == p.positionSide then found = i; break end
      end
      if tonumber(p.positionAmt) == 0 then
        if found then table.remove(positions, found) end
      elseif found then
        for k,v in pairs(p) do positions[found][k] = v end
      else table.insert(positions, p) end
      clocks[key] = stamp
      changed = true
    end
  end
  if not changed then return raw or '' end
  next.positions = positions
  next.eventTimes = clocks
  if next.complete == nil then next.complete = raw ~= false end
end
next.source = 'exchange'
next.account = ARGV[5]
next.at = ARGV[4]
next.positionsAt = ARGV[4]
next.stale = false
next.status = 'live'
next.version = redis.call('INCR', KEYS[2])
local encoded = cjson.encode(next)
-- Redis Lua encodes an empty table as {}; retain the JSON array contract.
for _,field in ipairs({'positions', 'openOrders', 'algoOrders', 'income', 'positionHistory', 'trades'}) do
  encoded = string.gsub(encoded, '"' .. field .. '":{}', '"' .. field .. '":[]')
end
redis.call('SET', KEYS[1], encoded, 'EX', 1200)
redis.call('PUBLISH', KEYS[3], cjson.encode({account=ARGV[5], version=next.version, at=ARGV[4]}))
return encoded
