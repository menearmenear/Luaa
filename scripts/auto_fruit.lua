--[[
  Auto-Fruit — a Blox-Fruit-style auto farm for the Playground sim.
  The three A's that power every "auto everything" script you find:
    AutoFarm  -> never stop hunting the nearest mob
    AutoSell  -> on a timer, sell your fruits for Beli
    Auto-Buy  -> spend Beli on the blade so damage scales forever
  Same skeleton as the real ones in downloads/luas: config table at
  the top, a Heartbeat game loop in the middle, a coroutine timer for
  the sell phase, and a HUD of SandboxSim buttons on top.
]]

local sim = SandboxSim
local Genv = getgenv and getgenv() or {}

local cfg = {
  autoFarm  = true,   -- chase + fight the nearest mob
  autoSell  = true,   -- sell fruits every sellEvery seconds
  autoBuy   = true,   -- auto-buy the blade when Beli allows
  sellEvery = 12,     -- seconds between fruit sales
  bladeCost = 30,     -- Beli per blade upgrade
  damage    = 6,      -- starting sword damage
  speed     = 6.0,    -- movement speed (studs/sec)
}

local Stat = { beli = 0, kills = 0, fruits = 0, sold = 0, left = 12, spawns = 0, pickups = 0, elapsed = 0 }
local lastEvent = "farm standing by"
local target, mode = nil, "idle"
local px, pz = 0, 0
local nextSell = 12

sim.show()
sim.setPlayer(0, 0, 20)
sim.setPlayerName("AutoFruit")
sim.setHealth(100, 100)

local function hud()
  sim.setGui("title",   { text = "AUTO FRUIT", x = 0.02, y = 0.02, w = 0.3, h = 0.06, color = "rgba(0,0,0,0.35)", textColor = "#ffe082" })
  sim.setGui("beli",    { text = "Beli $" .. Stat.beli, x = 0.64, y = 0.02, w = 0.34, h = 0.06, color = "#14261a", textColor = "#ffd54f" })
  sim.setGui("kills",   { text = "kills " .. Stat.kills, x = 0.64, y = 0.09, w = 0.16, h = 0.06, color = "#141c2e", textColor = "#e57373" })
  sim.setGui("mobs",    { text = "mobs " .. #sim.getMobs(), x = 0.82, y = 0.09, w = 0.16, h = 0.06, color = "#141c2e", textColor = "#b6c2ff" })
  sim.setGui("farm",    { text = "AutoFarm " .. (cfg.autoFarm and "ON" or "OFF"), x = 0.02, y = 0.86, w = 0.19, h = 0.08, color = cfg.autoFarm and "#0f3d2e" or "#3d2020", textColor = "#7CFC9A" })
  sim.setGui("sell",    { text = "AutoSell " .. (cfg.autoSell and "ON" or "OFF"), x = 0.23, y = 0.86, w = 0.19, h = 0.08, color = cfg.autoSell and "#0f3d2e" or "#3d2020", textColor = "#7CFC9A" })
  sim.setGui("buyb",    { text = "Auto-Buy blade", x = 0.44, y = 0.86, w = 0.20, h = 0.08, color = cfg.autoBuy and "#263c8a" or "#3d2020", textColor = "#ffffff" })
  sim.setGui("nextsell",{ text = "SELL in " .. Stat.left .. "s", x = 0.67, y = 0.86, w = 0.16, h = 0.08, color = "#263c8a", textColor = "#ffffff" })
  sim.setGui("stats",   { text = string.format("run %ds  |  spawned %d  |  fruits %d  |  sold %d  |  picked %d",
                            math.floor(Stat.elapsed), Stat.spawns, Stat.fruits, Stat.sold, Stat.pickups),
                          x = 0.02, y = 0.95, w = 0.60, h = 0.05, color = "#101418", textColor = "#8aa4c0" })
  sim.setGui("event",   { text = "last: " .. lastEvent, x = 0.64, y = 0.95, w = 0.34, h = 0.05, color = "#101418", textColor = "#ffd54f" })
end
hud()

-- GUI buttons: flip a config value, re-draw the HUD. Same as every hub.
local GUIMAP = { farm = "autoFarm", sell = "autoSell", buyb = "autoBuy" }
sim.on("gui", function(id)
  local key = GUIMAP[id]
  if key then cfg[key] = not cfg[key] end
  hud()
  if key then print("[AutoFruit] " .. id .. " toggled -> " .. tostring(cfg[key])) end
end)

-- AutoSell: real scripts run this on a timer coroutine. Ours uses task.wait.
task.spawn(function()
  while true do
    task.wait(1)
    Stat.left = Stat.left - 1
    if Stat.left <= 0 and cfg.autoSell and Stat.fruits > 0 then
      local payout = Stat.fruits * 2
      Stat.beli = Stat.beli + payout
      Stat.sold = Stat.sold + Stat.fruits
      Stat.left = cfg.sellEvery
      print(("[AutoSell] sold %d fruits -> +$%d Beli (total $%d)"):format(Stat.fruits, payout, Stat.beli))
      lastEvent = ("sold %d fruits +$%d"):format(Stat.fruits, payout)
      hud()
    end
  end
end)

-- the game loop. dt = seconds since last frame, from RunService.Heartbeat.
RunService.Heartbeat:Connect(function(dt)
  dt = dt or 0.016
  px, pz = sim.getPlayer()
  Stat.elapsed = Stat.elapsed + dt
  hud()

  -- AutoBuy: spend Beli before selling gets ahead of the shop
  if cfg.autoBuy and Stat.beli >= cfg.bladeCost then
    Stat.beli = Stat.beli - cfg.bladeCost
    cfg.damage = cfg.damage + 4
    print(("[AutoBuy] blade -> dmg %d (-$%d)"):format(cfg.damage, cfg.bladeCost))
    lastEvent = ("blade upgraded -> dmg %d"):format(cfg.damage)
    hud()
  end

  -- AutoFarm: pick the nearest mob, then fight it
  if cfg.autoFarm and not target then
    local best, bd = nil, 1e9
    for i, m in ipairs(sim.getMobs()) do
      local d2 = (m.x - px) ^ 2 + (m.z - pz) ^ 2
      if d2 < bd then bd, best = d2, m end
    end
    target, mode = best, best and "fight" or mode
  end

  if mode == "fight" and target then
    local dx, dz = target.x - px, target.z - pz
    local d = math.sqrt(dx * dx + dz * dz)
    sim.setPlayer(px, pz, math.deg(math.atan2(dx, dz)))
    if d > 1.4 then
      sim.setPlayer(px + dx / d * cfg.speed * dt, pz + dz / d * cfg.speed * dt)
    else
      target.hp = target.hp - cfg.damage
      if target.hp <= 0 then
        local kill = target
        Stat.kills = Stat.kills + 1
        Stat.fruits = Stat.fruits + 1
        target, mode = nil, "idle"
        sim.addCoin(kill.x, kill.z)         -- fruit drop on the ground
        print(("[KILL] %s -> %d kills, %d fruits"):format(kill.name or "mob", Stat.kills, Stat.fruits))
        lastEvent = ("killed %s (dmg %d)"):format(kill.name or "mob", cfg.damage)
        for i, m in ipairs(sim.getMobs()) do if m == kill then sim.removeMob(i) break end end
        hud()
      end
    end
  end

  -- pick up fruit drops
  for i = #sim.getCoins(), 1, -1 do
    local c = sim.getCoins()[i]
    if c and math.abs(c.x - px) < 0.8 and math.abs(c.z - pz) < 0.8 then
      sim.removeCoin(i)
      Stat.beli = Stat.beli + 5
      Stat.pickups = Stat.pickups + 1
      lastEvent = ("picked up fruit drop +$5")
    end
  end
end)

-- mob spawner (the "game" is spawning content for you to farm)
task.spawn(function()
  while true do
    task.wait(1.2)
    if #sim.getMobs() < 8 then
      Stat.spawns = Stat.spawns + 1
      sim.addMob(math.random(-10, 10), math.random(-6, 6),
        8 + math.min(20, math.floor(Stat.beli / 50) * 2), "#e57373", "FruitLooter")
      lastEvent = ("spawned a FruitLooter (hp scaled to $%d)"):format(Stat.beli)
      hud()
    end
  end
end)

print("== AUTO FRUIT ==")
print("AutoFarm/AutoSell/Auto-Buy all ON. Watch it play itself —")
print("that heartbeat loop is the same one big auto scripts use.")
print("HUD shows live stats; the bottom bar is the action ticker.")
hud()