# 설정 가이드

## _config.yml 설정

### 일반 사이트 설정
```yaml
title: UHD                        # 사이트 제목
logo: '/images/logo.png'         # 사이트 로고 경로
description: ''                  # 사이트 설명
baseurl: ""                     # 사이트 하위 경로
url: "https://hwanyong.github.io" # 사이트 도메인
```

### 작성자 설정
```yaml
author:
  name: Hwanyong Yoo
  avatar: '/images/users/uhd.jpg'
```

### 히어로 섹션
```yaml
hero:
  title: UHD's Playground
  description: Senior Software Engineer
  image: '/images/12.jpg'
```

### 연락처 설정
```yaml
contact:
  email: f/xlekwzgg
  description: 월 50회 무료 제출 가능
```

### 소셜 미디어 링크
```yaml
social:
- {icon: "ion-logo-instagram", link: "https://instagram.com/uhd_tech"}
- {icon: "ion-logo-youtube", link: "https://www.youtube.com/@uhd_tech"}
- {icon: "ion-logo-github", link: "https://github.com/hwanyong"}
- {icon: "ion-logo-youtube", link: "https://discord.gg/KcqHTZS35c"}
```

## Gemfile 설정

`Gemfile`은 프로젝트에 필요한 Ruby gems를 지정합니다:

```ruby
source "https://rubygems.org"

gem "jekyll"
# 사이트에 필요한 다른 gem들을 추가하세요
```

## 빌드 설정

로컬에서 사이트를 빌드하고 실행하는 방법:

1. 의존성 설치:
```bash
bundle install
```

2. 개발 서버 실행:
```bash
bundle exec jekyll serve
```

3. `http://localhost:4000`에서 사이트 접속

## 환경 변수

민감한 정보는 설정 파일이 아닌 환경 변수나 GitHub secrets에 저장해야 합니다.
