from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tracker", "0007_extraction")]
    operations = [
        migrations.AddField(model_name="issue", name="attachment_ids", field=models.JSONField(default=list)),
    ]
