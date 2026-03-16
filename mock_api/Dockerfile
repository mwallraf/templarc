FROM python:3.12-slim

# Build-time proxy support — pass via --build-arg or compose build.args.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn[standard]

COPY main.py .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
