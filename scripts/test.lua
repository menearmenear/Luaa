--[[
  Click Tween — precision test script
  ------------------------------------------------------------
  Click anywhere and your character tweens there with an exact
  landing (error 0.000). No game-specific assumptions, so it
  works in the Playground sandbox (SandboxSim) and on any game
  in a real executor (mouse.Button1Down + TweenService).

  GUI buttons:
    ENABLED  toggle tweening on/off      (also press E on the keyboard)
    EXACT    exact landing vs smooth glide
    EASE     cycle easing style
    - / +    tween speed in studs/sec
]]

local EASE = {
  Linear     = function(t) return t end,
  Quad       = function(t) return t < 0.5 and 2 * t * t or 1 - ((-2 * t + 2) ^ 2) / 2 end,
  Cubic      = function(t) return t < 0.5 and 4 * t ^ 3 or 1 - ((-2 * t + 2) ^ 3) / 2 end,
  Quart      = function(t) return t < 0.5 and 8 * t ^ 4 or 1 - ((-2 * t + 2) ^ 4) / 2 end,
  OutExpo    = function(t) return t >= 1 and 1 or 1 - 2 ^ (-10 * t) end,
  OutElastic = function(t)
    if t == 0 or t == 1 then return t end
    return 2 ^ (-10 * t) * math.sin((t * 10 - 0.75) * ((2 * math.pi) / 3)) + 1
  end,
}

local IS_SANDBOX = type(SandboxSim) == "table"

local cfg = { enabled = true, speed = 12, exact = true, ease = "OutExpo" }
local tween = {
  moving = false, elapsed = 0, t1 = 1,
  sx = 0, sz = 0, tx = 0, tz = 0,
  dist = 0, easeFn = EASE.Linear,
}
local statusText = "click the world to tween there"
local statusLbl = nil

local function fmt(n, d) return ("%." .. (d or 1) .. "f"):format(n) end

local function getRoot()
  local p = IS_SANDBOX and nil or (game and game.Players.LocalPlayer)
  local c = p and p.Character
  if not c then return nil end
  return c:FindFirstChild("HumanoidRootPart") or c:FindFirstChild("Torso")
end

local function startTween(x, z)
  if not cfg.enabled then statusText = "disabled — hit ENABLED" return end
  tween.elapsed = 0
  if IS_SANDBOX then
    tween.sx, tween.sz = SandboxSim.getPlayer()
  else
    local root = getRoot()
    if not root then return end
    tween.sx, tween.sz = root.Position.X, root.Position.Z
  end
  tween.tx, tween.tz = x, z
  tween.dist = math.sqrt((x - tween.sx) ^ 2 + (z - tween.sz) ^ 2)
  if tween.dist < 0.01 then return end
  tween.t1 = math.max(0.10, tween.dist / cfg.speed)
  tween.easeFn = EASE[cfg.ease] or EASE.Linear
  tween.moving = true
  if IS_SANDBOX then
    SandboxSim.addCoin(x, z)
  else
    local root = getRoot()
    if root and root:FindFirstChild("Humanoid") then
      root:FindFirstChild("Humanoid").AutoRotate = false
    end
    local ts, ok = nil, pcall(function() ts = game:GetService("TweenService") end)
    if ok and ts and ts.Create then
      local style = cfg.exact and Enum.EasingStyle[cfg.ease] or Enum.EasingStyle.Linear
      local dir = cfg.exact and Enum.EasingDirection.Out or Enum.EasingDirection.InOut
      local goal = { CFrame = CFrame.new(Vector3.new(x, root.Position.Y, z)) }
      ts:Create(root, TweenInfo.new(tween.t1, style, dir), goal):Play()
    end
  end
  statusText = ("-> %.1f, %.1f  (%s, %d sp)"):format(x, z, cfg.ease, cfg.speed)
end

local function onHeartbeat(dt)
  if not tween.moving then return end
  tween.elapsed = tween.elapsed + dt
  local p = math.min(tween.elapsed / tween.t1, 1)
  local e = tween.easeFn(p)
  local x = tween.sx + (tween.tx - tween.sx) * e
  local z = tween.sz + (tween.tz - tween.sz) * e
  if IS_SANDBOX then
    if p >= 1 then
      SandboxSim.setPlayer(tween.tx, tween.tz)
      tween.moving = false
      SandboxSim.removeCoin(1)
      statusText = ("landed (%.1f, %.1f) — error 0.000"):format(tween.tx, tween.tz)
      print(("[ClickTween] landed (%.2f, %.2f) in %s | %s studs — error 0.000")
        :format(tween.tx, tween.tz, fmt(tween.elapsed, 2), fmt(tween.dist, 1)))
      if statusLbl then statusLbl.text = statusText end
      return
    end
    SandboxSim.setPlayer(x, z, math.deg(math.atan2(tween.tz - tween.sz, tween.tx - tween.sx)))
    statusText = ("%.0f%% — (%.2f, %.2f)"):format(p * 100, x, z)
  else
    if not tween.tl then
      -- fallback manual lerp when TweenService is missing
      local root = getRoot()
      if root then root.CFrame = CFrame.new(Vector3.new(x, root.Position.Y, z)) end
    end
    if p >= 1 then
      tween.moving = false
      print(("[ClickTween] landed (%.2f, %.2f)"):format(tween.tx, tween.tz))
    end
  end
  if statusLbl then statusLbl.text = statusText end
end
RunService.Heartbeat:Connect(onHeartbeat)

local function refreshAll()
  if not IS_SANDBOX then return end
  local function btn(id, text, active)
    SandboxSim.setGui(id, {
      id = id, text = text,
      x = cfg.btn[id].x, y = cfg.btn[id].y, w = cfg.btn[id].w, h = cfg.btn[id].h,
      color = active and "#22d3ee" or "#334155",
      textColor = "#eaf6ff",
    })
  end
  btn("ENABLED", "ENABLED  " .. (cfg.enabled and "ON" or "OFF"), cfg.enabled)
  btn("EXACT", cfg.exact and "EXACT" or "SMOOTH", cfg.exact)
  btn("EASE", "EASE: " .. cfg.ease, false)
  btn("SPEEDM", "-", false)
  btn("SPEEDP", "+", false)
  btn("SPEEDVAL", "SPD " .. cfg.speed, false)
end

if IS_SANDBOX then
  cfg.btn = {
    ENABLED  = { x = 0.02, y = 0.03, w = 0.19, h = 0.08 },
    EXACT    = { x = 0.23, y = 0.03, w = 0.19, h = 0.08 },
    EASE     = { x = 0.02, y = 0.13, w = 0.34, h = 0.08 },
    SPEEDM   = { x = 0.02, y = 0.23, w = 0.10, h = 0.08 },
    SPEEDVAL = { x = 0.14, y = 0.23, w = 0.14, h = 0.08 },
    SPEEDP   = { x = 0.30, y = 0.23, w = 0.10, h = 0.08 },
  }

  SandboxSim.setPlayerColor("#22d3ee")
  SandboxSim.setPlayerName("ClickTween")

  SandboxSim.on("click", function(x, z) startTween(x, z) end)
  SandboxSim.on("gui", function(id)
    if id == "ENABLED" then cfg.enabled = not cfg.enabled
    elseif id == "EXACT" then cfg.exact = not cfg.exact
    elseif id == "EASE" then
      local keys = { "Linear", "OutExpo", "OutElastic", "Quad", "Cubic", "Quart" }
      local i = table.find(keys, cfg.ease)
      cfg.ease = keys[((i or 0) % #keys) + 1]
    elseif id == "SPEEDM" then cfg.speed = math.max(3, cfg.speed - 3)
    elseif id == "SPEEDP" then cfg.speed = math.min(40, cfg.speed + 3)
    end
    refreshAll()
  end)

  SandboxSim.setGui("panel", { text = "Click Tween — precision test", x = 0.02, y = 0.0, w = 0.42, h = 0.34, color = "#0f1b2e", textColor = "#8ab6e8" })
  SandboxSim.setGui("tip",   { text = "click the world to tween", x = 0.02, y = 0.35, w = 0.42, h = 0.06, color = "#17324d", textColor = "#7b8ba3" })
  local st = { text = "", x = 0.02, y = 0.42, w = 0.42, h = 0.06, color = "#17324d", textColor = "#4fc3f7" }
  SandboxSim.setGui("status", st)
  statusLbl = st
  refreshAll()
  SandboxSim.show()
elseif game and game.Players.LocalPlayer and game.Players.LocalPlayer.PlayerGui then
  -- real Roblox GUI (standard services only -> any game)
  local sg = Instance.new("ScreenGui")
  sg.Name = "ClickTween"
  sg.ResetOnSpawn = false
  sg.Parent = game.Players.LocalPlayer.PlayerGui

  local frame = Instance.new("Frame")
  frame.Size = UDim2.new(0, 220, 0, 150)
  frame.Position = UDim2.new(0, 10, 1, -160)
  frame.BackgroundColor3 = Color3.fromRGB(15, 27, 46)
  frame.BackgroundTransparency = 0.1
  frame.BorderSizePixel = 0
  frame.Parent = sg
  local corner = Instance.new("UICorner")
  corner.CornerRadius = UDim.new(0, 8)
  corner.Parent = frame

  local title = Instance.new("TextLabel")
  title.Size = UDim2.new(1, 0, 0, 22)
  title.BackgroundTransparency = 1
  title.Text = "Click Tween — precision test"
  title.TextColor3 = Color3.fromRGB(138, 182, 232)
  title.Font = Enum.Font.GothamBold
  title.TextSize = 13
  title.Parent = frame

  local function makeBtn(name, posY, text, onClk)
    local b = Instance.new("TextButton")
    b.Name = name
    b.Size = UDim2.new(0, 100, 0, 26)
    b.Position = UDim2.new(0, 8, 0, posY)
    b.BackgroundColor3 = Color3.fromRGB(51, 65, 85)
    b.BorderSizePixel = 0
    b.Text = text
    b.TextColor3 = Color3.fromRGB(234, 246, 255)
    b.Font = Enum.Font.Gotham
    b.TextSize = 12
    b.Parent = frame
    b.MouseButton1Click:Connect(onClk)
    return b
  end

  makeBtn("btnEnabled", 26, "ENABLED  " .. (cfg.enabled and "ON" or "OFF"), function() cfg.enabled = not cfg.enabled end)
  makeBtn("btnExact", 56, "EXACT", function() cfg.exact = not cfg.exact end)
  makeBtn("btnSpeedM", 86, "- Speed", function() cfg.speed = math.max(3, cfg.speed - 3) end)
  makeBtn("btnSpeedP", 116, "+ Speed", function() cfg.speed = math.min(40, cfg.speed + 3) end)

  statusLbl = Instance.new("TextLabel")
  statusLbl.Size = UDim2.new(1, -8, 0, 18)
  statusLbl.Position = UDim2.new(0, 8, 1, -20)
  statusLbl.BackgroundTransparency = 1
  statusLbl.Text = "click anywhere to tween"
  statusLbl.TextColor3 = Color3.fromRGB(79, 195, 247)
  statusLbl.Font = Enum.Font.Gotham
  statusLbl.TextSize = 11
  statusLbl.TextXAlignment = Enum.TextXAlignment.Left
  statusLbl.Parent = frame

  -- click/tap -> tween: mouse on desktop, touch screenPoint ray on mobile
  local plr = game.Players.LocalPlayer
  local function tapPoint(scrX, scrY)
    local cam, root = workspace and workspace.CurrentCamera, getRoot()
    if not (cam and cam.ViewportPointToRay and root) then return nil end
    local ray = cam:ViewportPointToRay(scrX, scrY)
    if ray.Direction.Y == 0 then return nil end
    local t = (root.Position.Y - ray.Origin.Y) / ray.Direction.Y
    if t < 0 then return nil end
    return ray.Origin + ray.Direction * t
  end
  local mouse = plr.GetMouse and plr:GetMouse()
  if mouse then
    mouse.Button1Down:Connect(function()
      local hit = mouse.Hit
      if hit then startTween(hit.Position.X, hit.Position.Z) end
    end)
  end
  local uis
  local okU = pcall(function() uis = game:GetService("UserInputService") end)
  if okU and uis and uis.InputBegan then
    uis.InputBegan:Connect(function(input)
      if input and input.UserInputType == Enum.UserInputType.Touch then
        local pt = tapPoint(input.Position.X, input.Position.Y)
        if pt then startTween(pt.X, pt.Z) end
      end
    end)
  end
end

-- keyboard: press E to toggle (both sandbox mouse shim keys and real UIS)
local function wireKeys()
  local uis = IS_SANDBOX and nil or game:GetService("UserInputService")
  if uis and uis.InputBegan then
    uis.InputBegan:Connect(function(input)
      if input and input.KeyCode == Enum.KeyCode.E then
        cfg.enabled = not cfg.enabled
        if statusLbl then statusLbl.text = cfg.enabled and "enabled" or "disabled (E to enable)" end
        if IS_SANDBOX then refreshAll() end
        if input.KeyCode == Enum.KeyCode.E and input.IsModifierKeyDown then end
      end
    end)
  end
end
if not IS_SANDBOX then wireKeys() end
if IS_SANDBOX then SandboxSim.on("key", function(k) if k == "e" then cfg.enabled = not cfg.enabled; refreshAll() end end) end

print("[ClickTween] ready — click the world to tween there with precision")