@ -1,177 +0,0 @@
# Docker Setup for Backend Stocks Application

This guide will help you containerize and run the Node.js backend application using Docker.

## Prerequisites

1. **Docker Desktop** - Install from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. **Docker Compose** - Included with Docker Desktop

## Quick Start

### Option 1: Using Docker Compose (Recommended)

1. **Start Docker Desktop** and ensure it's running
2. **Build and run** the application:
   ```bash
   docker-compose up -d
   ```

3. **Check if it's running**:
   ```bash
   docker-compose ps
   ```

4. **View logs**:
   ```bash
   docker-compose logs -f backend-stocks
   ```

5. **Stop the application**:
   ```bash
   docker-compose down
   ```

### Option 2: Using Docker Commands

1. **Build the image**:
   ```bash
   docker build -t backend-stocks:latest .
   ```

2. **Run the container**:
   ```bash
   docker run -d -p 3012:3012 --env-file .env --name backend-stocks-app backend-stocks:latest
   ```

3. **Check container status**:
   ```bash
   docker ps
   ```

4. **View logs**:
   ```bash
   docker logs -f backend-stocks-app
   ```

5. **Stop the container**:
   ```bash
   docker stop backend-stocks-app
   docker rm backend-stocks-app
   ```

## Windows Users

For Windows users, you can use the provided batch files:

- **Build**: Double-click `docker-build.bat`
- **Run**: Double-click `docker-run.bat`

## Application Access

Once running, the application will be available at:
- **Main Application**: http://localhost:3012
- **API Documentation**: http://localhost:3012/api-docs
- **Health Check**: http://localhost:3012/health

## Environment Variables

The application uses the `.env` file for configuration. Key variables:
- `PORT=3012` - Application port
- `NODE_ENV=production` - Environment mode
- `MONGODB_URI` - Database connection string
- Other service credentials (Google OAuth, Telegram, Email, etc.)

## Docker Configuration Details

### Dockerfile Features
- **Base Image**: Node.js 18 Alpine (lightweight)
- **Security**: Runs as non-root user
- **Dependencies**: Includes Chromium for Puppeteer
- **Health Check**: Built-in health monitoring
- **Optimization**: Multi-stage build for smaller image size

### Docker Compose Features
- **Port Mapping**: 3012:3012
- **Volume Mounts**: Persistent logs directory
- **Health Checks**: Automatic container health monitoring
- **Restart Policy**: Automatically restarts on failure
- **Network**: Isolated bridge network

## Troubleshooting

### Common Issues

1. **Port Already in Use**:
   ```bash
   # Check what's using port 3012
   netstat -ano | findstr :3012
   # Kill the process or change the port in docker-compose.yml
   ```

2. **Docker Desktop Not Running**:
   - Start Docker Desktop application
   - Wait for it to fully initialize

3. **Build Failures**:
   ```bash
   # Clean Docker cache
   docker system prune -a
   # Rebuild without cache
   docker-compose build --no-cache
   ```

4. **Container Won't Start**:
   ```bash
   # Check logs for errors
   docker-compose logs backend-stocks
   ```

5. **Database Connection Issues**:
   - Ensure MongoDB URI in `.env` is accessible from container
   - Check network connectivity

### Health Check

The application includes a health check endpoint at `/health` that returns:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-27T10:30:00.000Z",
  "uptime": 123.456,
  "environment": "production"
}
```

## Production Deployment

For production deployment:

1. **Use environment-specific .env files**
2. **Set up proper logging volumes**
3. **Configure reverse proxy (nginx)**
4. **Set up monitoring and alerts**
5. **Use Docker secrets for sensitive data**

## File Structure

```
backend-stocks/
├── Dockerfile              # Docker image definition
├── docker-compose.yml      # Docker Compose configuration
├── .dockerignore           # Files to exclude from build
├── docker-build.bat        # Windows build script
├── docker-run.bat          # Windows run script
├── DOCKER_README.md        # This file
└── .env                    # Environment variables
```

## Support

If you encounter issues:
1. Check the logs: `docker-compose logs -f backend-stocks`
2. Verify Docker Desktop is running
3. Ensure all environment variables are set correctly
4. Check port availability

The application should start successfully and be accessible at http://localhost:3012 with full functionality including API documentation at /api-docs.