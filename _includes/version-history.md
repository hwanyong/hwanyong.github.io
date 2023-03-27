<h4>Related Releases</h4>
<ul>
{% for post in site.posts %}
	{% if post.projectIdx != page.projectIdx and !post.enable %}
		{% continue %}
	{% endif %}

	<li>
		[v{{ post.version }}]({{ post.url }})
	</li>
{% endfor %}
</ul>