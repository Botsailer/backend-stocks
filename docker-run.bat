@echo off
echo Starting backend-stocks with Docker Compose...
docker-compose up -d

echo.
echo Container started! Check status with:
echo docker-compose ps
echo.
echo View logs with:
echo docker-compose logs -f backend-stocks
echo.
echo Stop with:
echo docker-compose down
pause