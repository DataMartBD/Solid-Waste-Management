"""The `super_admin` role joins the choice list.

Structure only — `0005` is what moves anybody onto it. Split in two so the
choice exists before a row can hold it, which is what lets the data step be
re-run or reversed on its own.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_user_agency'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(choices=[('collector', 'Collector'), ('supervisor', 'Supervisor'), ('agency_admin', 'Agency Admin'), ('super_admin', 'Super Admin'), ('kcc_viewer', 'KCC Viewer')], default='collector', max_length=20),
        ),
    ]
