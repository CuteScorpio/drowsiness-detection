# DrowseGuard — Full Deployment Guide
## GitHub → AWS EC2 (with HTTPS for Mobile Camera)

---

## PART 1: Push Code to GitHub

### Step 1.1 — Create GitHub Repository
1. Go to **github.com** → click **New** (top-left green button)
2. Repository name: `drowsiness-detection`
3. Set to **Public** (or Private)
4. **Do NOT** initialize with README (you already have one)
5. Click **Create repository**

### Step 1.2 — Initialize Git Locally
Open terminal in your project folder and run:

```bash
cd drowsiness-detection

git init
git add .
git commit -m "Initial commit: DrowseGuard drowsiness detection system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/drowsiness-detection.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

---

## PART 2: Launch EC2 Instance on AWS

### Step 2.1 — Create EC2 Instance
1. Log into **AWS Console** → go to **EC2**
2. Click **Launch Instance**
3. Settings:
   - **Name**: `drowseguard-server`
   - **AMI**: Ubuntu Server 22.04 LTS (free tier eligible)
   - **Instance type**: `t2.micro` (free tier) or `t2.small` (recommended for MediaPipe)
   - **Key pair**: Create new → name it `drowseguard-key` → download `.pem` file
   - **Security Group**: Create new with these rules:
     - SSH (port 22) — Source: My IP
     - HTTP (port 80) — Source: Anywhere (0.0.0.0/0)
     - HTTPS (port 443) — Source: Anywhere (0.0.0.0/0)
4. **Storage**: 20 GB gp3 (MediaPipe needs space)
5. Click **Launch Instance**

### Step 2.2 — Connect to EC2
```bash
# Fix key permissions (Mac/Linux)
chmod 400 drowseguard-key.pem

# SSH into instance
ssh -i drowseguard-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

Find your EC2 Public IP in the AWS console under **Instances → your instance → Public IPv4 address**.

---

## PART 3: Set Up Server

### Step 3.1 — System Update & Install Dependencies
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-pip python3-venv nginx git certbot python3-certbot-nginx
```

### Step 3.2 — Clone Your Repository
```bash
cd /home/ubuntu
git clone https://github.com/YOUR_USERNAME/drowsiness-detection.git
cd drowsiness-detection
```

### Step 3.3 — Python Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

> ⚠️ MediaPipe installation may take 3–5 minutes on t2.micro. Be patient.

### Step 3.4 — Test the App
```bash
python app.py
# Should show: Running on http://0.0.0.0:5000
# Press Ctrl+C to stop
```

---

## PART 4: Configure Nginx (Reverse Proxy)

### Step 4.1 — Set Up Nginx Config
```bash
sudo cp /home/ubuntu/drowsiness-detection/nginx.conf /etc/nginx/sites-available/drowseguard

# Edit the file to add your domain/IP
sudo nano /etc/nginx/sites-available/drowseguard
```

> In the file, replace `YOUR_DOMAIN_OR_IP` with your actual domain or EC2 IP.
> If using IP only (no domain), see the "IP-only HTTPS" note below.

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/drowseguard /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # Remove default

# Test config
sudo nginx -t

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## PART 5: Set Up HTTPS (CRITICAL for Mobile Camera)

> **WHY THIS MATTERS**: Chrome on Android and Safari on iOS **REQUIRE HTTPS** for `getUserMedia()` (camera access). Without HTTPS, camera will not work on mobile.

### Option A — You Have a Domain Name (Recommended)
```bash
# Point your domain's A record to EC2 IP first, then:
sudo certbot --nginx -d yourdomain.com
```

Follow the prompts. Certbot will automatically edit your Nginx config.

### Option B — IP Only (Self-Signed Certificate)
If you don't have a domain, use a self-signed cert (users will see a browser warning, but camera will work):

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/drowseguard.key \
  -out /etc/ssl/certs/drowseguard.crt \
  -subj "/C=IN/ST=Maharashtra/L=Pune/O=DrowseGuard/CN=YOUR_EC2_IP"
```

Then edit `/etc/nginx/sites-available/drowseguard`:
```nginx
server {
    listen 443 ssl http2;
    server_name YOUR_EC2_IP;
    ssl_certificate /etc/ssl/certs/drowseguard.crt;
    ssl_certificate_key /etc/ssl/private/drowseguard.key;
    # ... rest of config
}
```

On mobile, when you open the site:
- Chrome: Tap **Advanced** → **Proceed to site**
- Safari: Tap **Show Details** → **visit this website**

### Option C — Free Domain via Freenom or DuckDNS
Get a free domain at `duckdns.org` → point it to your EC2 IP → use Certbot.

---

## PART 6: Run as a Service (Auto-start)

```bash
# Copy service file
sudo cp /home/ubuntu/drowsiness-detection/drowseguard.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable drowseguard
sudo systemctl start drowseguard

# Check status
sudo systemctl status drowseguard

# View logs
sudo journalctl -u drowseguard -f
```

---

## PART 7: Verify Everything Works

```bash
# Check Nginx
sudo systemctl status nginx

# Check Flask app
sudo systemctl status drowseguard

# Check ports
sudo ss -tlnp | grep -E '80|443|5000'

# Test health endpoint
curl https://yourdomain.com/health
```

Open `https://yourdomain.com` in browser. You should see the DrowseGuard interface.

---

## PART 8: Mobile Camera Access Checklist

| Check | Required? | Notes |
|-------|-----------|-------|
| HTTPS | ✅ YES | Mandatory for camera on mobile |
| Permissions-Policy header | ✅ YES | Already in nginx.conf |
| `playsinline` on video | ✅ YES | Already in index.html |
| `muted` on video | ✅ YES | Required for autoplay on iOS |
| `facingMode: {ideal:'user'}` | ✅ YES | Selects front camera by default |
| Audio unlock gesture | ✅ YES | iOS requires tap before playing audio |

---

## PART 9: Update Code (Git Pull Workflow)

When you make changes locally:
```bash
# Local machine
git add .
git commit -m "Your changes"
git push origin main

# On EC2 server
cd /home/ubuntu/drowsiness-detection
git pull origin main
source venv/bin/activate
pip install -r requirements.txt  # if requirements changed
sudo systemctl restart drowseguard
```

---

## Troubleshooting

### Camera not working on mobile
1. Verify HTTPS is working: `curl -I https://yourdomain.com`
2. Check Permissions-Policy header is present
3. Try in Chrome (most compatible)
4. Make sure you tapped "Allow" on the browser permission prompt
5. On iOS Safari: Settings → Safari → Camera → Allow

### App crashes / 502 Bad Gateway
```bash
sudo journalctl -u drowseguard -n 50
# If memory issue on t2.micro, add swap:
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### MediaPipe import error
```bash
source venv/bin/activate
pip install mediapipe --upgrade
```

### Port 5000 not accessible
```bash
# Check security group in AWS Console
# Inbound rules must have port 80 and 443 open to 0.0.0.0/0
```

---

## Architecture Overview

```
Mobile/Desktop Browser
        │
        │ HTTPS (port 443)
        ▼
    AWS EC2
    ┌─────────────┐
    │   Nginx      │  ← SSL termination, static files
    │   (port 443) │
    └──────┬──────┘
           │ proxy_pass
           ▼
    ┌─────────────┐
    │  Gunicorn    │  ← Production WSGI server
    │  (port 5000) │
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │   Flask App  │  ← /analyze endpoint
    └──────┬──────┘
           │
           ▼
    ┌─────────────────────┐
    │  MediaPipe FaceMesh  │  ← 468 landmark detection
    │  EAR + MAR Algorithm │  ← Drowsiness scoring
    └─────────────────────┘
```
