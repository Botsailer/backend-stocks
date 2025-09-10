@echo off
echo Building Docker image for backend-stocks...
docker build -t backend-stocks:latest .

echo.
echo Build completed! To run the container:
echo docker run -p 3012:3012 --env-file .env backend-stocks:latest
echo.
echo Or use docker-compose:
echo docker-compose up -d
pause