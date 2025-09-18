import os
from flask import Flask, render_template_string, request
import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()
#  python3 -m venv .venv && source .venv/bin/activate
# pip install flask boto3 botocore python-dotenv
# cp .env.example .env  # Create your local .env file from the example
# python3 main.py
# http://localhost:8000


app = Flask(__name__)

# ---- Config (env-first, sane defaults for your demo) -----------------------------------------
CATS_BUCKET = os.getenv("CATS_BUCKET", "")  # from CloudFormation demo
DOGS_BUCKET = os.getenv("DOGS_BUCKET", "")  # often denied in the demo policy
CATS_PREFIX = os.getenv("CATS_PREFIX", "")         # "" = root (no prefix), or "cats/" for folder
DOGS_PREFIX = os.getenv("DOGS_PREFIX", "")         # "" = root (no prefix), or "dogs/" for folder
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")          # e.g. "us-east-1"; None = default chain
AWS_PROFILE = os.getenv("AWS_PROFILE") # AWS profile to use
MAX_IMAGES = int(os.getenv("MAX_IMAGES", "10"))

if not CATS_BUCKET or not DOGS_BUCKET:
    raise ValueError("CATS_BUCKET and DOGS_BUCKET must be set")

# Build a single S3 client using the specified AWS profile (iamadmin-general by default)
if AWS_PROFILE:
    session = boto3.Session(region_name=AWS_REGION, profile_name=AWS_PROFILE)
else:
    session = boto3.Session(region_name=AWS_REGION)
s3 = session.client("s3")

# ---- Helpers ----------------------------------------------------------------------------------

def list_image_objects(bucket: str, prefix: str = "", max_keys: int = 100):
    """Return (keys, error) where keys is a list of object keys (non-folders).
    If access is denied or the bucket is missing, keys will be [], and error will be a dict.
    """
    try:
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=max_keys)
        contents = resp.get("Contents", [])
        keys = [obj["Key"] for obj in contents if not obj["Key"].endswith("/")]
        return keys, None
    except ClientError as e:
        err = {
            "code": e.response.get("Error", {}).get("Code", "UnknownError"),
            "message": e.response.get("Error", {}).get("Message", str(e)),
            "bucket": bucket,
        }
        return [], err


def presign_urls(bucket: str, keys):
    urls = []
    for k in keys:
        try:
            url = s3.generate_presigned_url(
                ClientMethod="get_object",
                Params={"Bucket": bucket, "Key": k},
                ExpiresIn=3600,
            )
            urls.append({"key": k, "url": url})
        except ClientError as e:
            # If presign itself ever fails (rare; permission checked at GET time), surface it in UI.
            urls.append({
                "key": k,
                "url": None,
                "error": {
                    "code": e.response.get("Error", {}).get("Code", "UnknownError"),
                    "message": e.response.get("Error", {}).get("Message", str(e)),
                },
            })
    return urls


HTML = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>S3 Cats vs Dogs</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div class="max-w-7xl mx-auto p-6">
      <header class="mb-6 flex items-baseline justify-between">
        <h1 class="text-2xl font-bold">S3 Cats vs Dogs</h1>
        <div class="text-xs text-slate-500">Creds source: server-side (boto3)</div>
      </header>

      <div class="grid md:grid-cols-2 gap-6">
        <!-- Cats column -->
        <section class="bg-white rounded-2xl shadow p-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-lg font-semibold">Cats</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">bucket: {{ cats.bucket }}</span>
          </div>

          {% if cats.error %}
            <div class="p-3 rounded-lg bg-rose-50 text-rose-700 text-sm">
              <strong>{{ cats.error.code }}</strong>: {{ cats.error.message }}
            </div>
          {% elif cats.images|length == 0 %}
            <p class="text-sm text-slate-500">No images found in this bucket/prefix.</p>
          {% else %}
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {% for img in cats.images %}
                <figure class="rounded-xl overflow-hidden border bg-slate-100">
                  {% if img.url %}
                    <img src="{{ img.url }}" alt="{{ img.key }}" loading="lazy"
                         class="w-full h-40 object-cover"
                         onerror="this.closest('figure').classList.add('opacity-50'); this.after(Object.assign(document.createElement('figcaption'),{className:'p-2 text-xs text-rose-700',innerText:'403/Access error when fetching image'}));"/>
                  {% else %}
                    <div class="p-2 text-xs text-rose-700">{{ img.error.code }}: {{ img.error.message }}</div>
                  {% endif %}
                  <figcaption class="p-2 text-[10px] text-slate-500 truncate">{{ img.key }}</figcaption>
                </figure>
              {% endfor %}
            </div>
          {% endif %}
        </section>

        <!-- Dogs column -->
        <section class="bg-white rounded-2xl shadow p-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-lg font-semibold">Dogs</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">bucket: {{ dogs.bucket }}</span>
          </div>

          {% if dogs.error %}
            <div class="p-3 rounded-lg bg-rose-50 text-rose-700 text-sm">
              <strong>{{ dogs.error.code }}</strong>: {{ dogs.error.message }}
            </div>
          {% elif dogs.images|length == 0 %}
            <p class="text-sm text-slate-500">No images found in this bucket/prefix.</p>
          {% else %}
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {% for img in dogs.images %}
                <figure class="rounded-xl overflow-hidden border bg-slate-100">
                  {% if img.url %}
                    <img src="{{ img.url }}" alt="{{ img.key }}" loading="lazy"
                         class="w-full h-40 object-cover"
                         onerror="this.closest('figure').classList.add('opacity-50'); this.after(Object.assign(document.createElement('figcaption'),{className:'p-2 text-xs text-rose-700',innerText:'403/Access error when fetching image'}));"/>
                  {% else %}
                    <div class="p-2 text-xs text-rose-700">{{ img.error.code }}: {{ img.error.message }}</div>
                  {% endif %}
                  <figcaption class="p-2 text-[10px] text-slate-500 truncate">{{ img.key }}</figcaption>
                </figure>
              {% endfor %}
            </div>
          {% endif %}
        </section>
      </div>

      <footer class="mt-8 text-xs text-slate-500">
        <div>Using presigned URLs (1h). If your role is denied <code>s3:ListBucket</code> or <code>s3:GetObject</code> on a bucket, you'll see an error banner here or broken tiles.</div>
        <div class="mt-1">Buckets/prefixes and region are configurable via environment variables.</div>
      </footer>
    </div>
  </body>
</html>
"""


@app.route("/")
def index():
    cats_keys, cats_err = list_image_objects(CATS_BUCKET, CATS_PREFIX, MAX_IMAGES)
    dogs_keys, dogs_err = list_image_objects(DOGS_BUCKET, DOGS_PREFIX, MAX_IMAGES)

    cats = {
        "bucket": CATS_BUCKET,
        "error": cats_err,
        "images": [] if cats_err else presign_urls(CATS_BUCKET, cats_keys),
    }
    dogs = {
        "bucket": DOGS_BUCKET,
        "error": dogs_err,
        "images": [] if dogs_err else presign_urls(DOGS_BUCKET, dogs_keys),
    }

    return render_template_string(HTML, cats=cats, dogs=dogs)


@app.get("/healthz")
def healthz():
    return {"ok": True}


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    debug = os.getenv("DEBUG", "false").lower() in {"1", "true", "yes", "on"}
    app.run(host=host, port=port, debug=debug)
