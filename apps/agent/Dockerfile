FROM mcr.microsoft.com/playwright/python:v1.62.0-noble

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY apps/agent/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/agent/app ./app
# .data must exist in the image before the chown: docker-compose mounts the proofline_usage
# volume there, and Docker creates a missing mountpoint as root, which the unprivileged user
# below then cannot write. An empty named volume inherits this directory's ownership instead.
RUN useradd --create-home --uid 10001 proofline && mkdir -p /app/.data && chown -R proofline:proofline /app
USER proofline
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
