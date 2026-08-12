"""The national geography table: division → district → upazila → union.

Structure only. The 4,537 rows are loaded by `manage.py load_geo_locations`,
kept out of the migration because reference data that ships as a file should be
reloadable without rewriting history — and because a migration carrying 1.5 MB
of JSON is a migration nobody can read.

Reversible: dropping the table loses nothing that is not in the file.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('catalog', '0002_block'),
    ]

    operations = [
        migrations.CreateModel(
            name='GeoLocation',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('division_name', models.CharField(max_length=64)),
                ('division_bn', models.CharField(max_length=64)),
                ('district_name', models.CharField(max_length=64)),
                ('district_bn', models.CharField(max_length=64)),
                ('upazila_name', models.CharField(max_length=96)),
                ('upazila_bn', models.CharField(max_length=96)),
                ('union_name', models.CharField(max_length=96)),
                ('union_bn', models.CharField(max_length=96)),
            ],
            options={
                'db_table': 'geo_location',
                'ordering': ['division_name', 'district_name', 'upazila_name', 'union_name'],
                'indexes': [models.Index(fields=['district_name'], name='geo_district_idx'), models.Index(fields=['district_name', 'upazila_name'], name='geo_upazila_idx')],
                'constraints': [models.UniqueConstraint(fields=('division_name', 'district_name', 'upazila_name', 'union_name'), name='geo_location_unique_union')],
            },
        ),
    ]
