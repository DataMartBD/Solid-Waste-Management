"""A holding gets a building type by structure (অবকাঠামো অনুযায়ী).

Schema only. The data move is 0021: on PostgreSQL, updating rows in the same
transaction that adds an FK column stops the column's index from being built
("pending trigger events").
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('catalog', '0014_structure_type'),
        ('customers', '0019_holding_photo'),
    ]

    operations = [
        migrations.AddField(
            model_name='holding',
            name='structure_type',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='holdings', to='catalog.structuretype'),
        ),
    ]
